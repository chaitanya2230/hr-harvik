import mongoose, { Types } from 'mongoose';
import { Candidate } from './candidate.model';
import { Job } from './job.model';
import { Employee } from '../employees/employee.model';
import { User } from '../users/user.model';
import { defaultStatusFor } from '../employees/employee.service';
import { nextHumanId } from '../../utils/ids';
import { initializeEmployeeBalances } from '../leave/leave-balance.service';
import { createOnboardingForEmployee } from '../onboarding/onboarding.service';
import { hashPassword } from '../auth/auth.service';
import { recordAudit } from '../audit/audit.service';
import { invalidateDashboardCache } from '../dashboard/dashboard.cache';
import { conflict, notFound, unprocessable } from '../../utils/errors';
import type { AuthAccount } from '../auth/auth.service';
import type { ConvertCandidateBody } from './recruitment.validation';

export interface ConversionContext {
  account: AuthAccount;
  ip?: string;
  userAgent?: string;
}

export interface ConversionResult {
  candidateId: string;
  candidateCode: string;
  employeeId: string;
  employeeCode: string;
  jobId: string;
  jobCode: string;
  filledCount: number;
  openings: number;
}

const toId = (val: string): Types.ObjectId => new Types.ObjectId(val);

export async function convertCandidateToEmployee(
  candidateIdStr: string,
  body: ConvertCandidateBody,
  ctx: ConversionContext,
): Promise<ConversionResult> {
  const candidateId = toId(candidateIdStr);
  const candidate = await Candidate.findOne({ _id: candidateId, isDeleted: false }).exec();
  if (!candidate) throw notFound('Candidate');

  // AGENTS.md §8.3 — candidate conversion preconditions
  if (candidate.convertedEmployeeId) {
    throw conflict(`Candidate ${candidate.candidateCode} has already been converted to an employee`);
  }

  const isEligibleStage =
    candidate.stage === 'Joined' ||
    (candidate.stage === 'Offer' && candidate.offerStatus === 'Accepted');

  if (!isEligibleStage) {
    throw unprocessable(
      `Candidate must be in "Joined" stage or have an "Accepted" offer to be converted (currently: stage="${candidate.stage}", offerStatus="${candidate.offerStatus}")`,
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Atomic job opening consumption to prevent concurrency race
    const job = await Job.findOne({ _id: candidate.jobId, isDeleted: false })
      .session(session)
      .exec();

    if (!job) {
      throw unprocessable('Associated job opening does not exist');
    }

    if (job.filledCount >= job.openings) {
      throw unprocessable('No open positions remaining for this job opening');
    }

    const currentFilled = job.filledCount;
    const claim = await Job.updateOne(
      { _id: job._id, isDeleted: false, filledCount: currentFilled },
      { $inc: { filledCount: 1 } },
      { session },
    ).exec();

    if (claim.matchedCount === 0) {
      throw unprocessable('No open positions remaining for this job opening');
    }

    job.filledCount = currentFilled + 1;
    if (job.filledCount >= job.openings) {
      job.status = 'Filled';
      await job.save({ session });
    }

    // 2. Generate atomic employee code HRV-####
    const employeeCode = await nextHumanId('employee');

    // 3. Name parsing
    const parts = candidate.name.trim().split(/\s+/);
    const firstName = parts[0] || 'Employee';
    const lastName = parts.slice(1).join(' ') || '.';

    const status = defaultStatusFor(body.employmentType);
    const departmentId = body.departmentId ? toId(body.departmentId) : job.departmentId;
    const reportingManagerId = body.reportingManagerId
      ? toId(body.reportingManagerId)
      : job.hiringManagerId;

    // 4. Create Employee inside transaction
    const createdEmployees = await Employee.create(
      [
        {
          employeeCode,
          firstName,
          lastName,
          email: candidate.email,
          phone: candidate.phone,
          dob: null,
          photoUrl: null,
          address: {},
          emergencyContact: {},
          designation: body.designation,
          departmentId,
          reportingManagerId,
          employmentType: body.employmentType,
          dateOfJoining: body.dateOfJoining,
          probationEndDate: null,
          compensation: body.compensation ?? {},
          bankDetails: {},
          status,
          statusHistory: [
            {
              status,
              changedAt: new Date(),
              changedBy: ctx.account.userId ? toId(ctx.account.userId) : null,
              note: `Created from candidate ${candidate.candidateCode}`,
            },
          ],
          employmentHistory: [
            {
              employmentType: body.employmentType,
              designation: body.designation,
              departmentId,
              from: new Date(`${body.dateOfJoining}T00:00:00.000Z`),
              to: null,
              note: 'Initial employment record from recruitment conversion',
            },
          ],
          createdBy: ctx.account.userId ? toId(ctx.account.userId) : null,
          isDeleted: false,
        },
      ],
      { session },
    );

    const employee = createdEmployees[0];
    if (!employee) throw unprocessable('Failed to create employee record');

    // 5. Optionally create User login
    if (body.createLogin) {
      const loginEmail = body.createLogin.email.toLowerCase();
      const existingUser = await User.findOne({ email: loginEmail }).session(session).exec();
      if (existingUser) {
        throw conflict(`A user login already exists with email ${loginEmail}`);
      }
      await User.create(
        [
          {
            email: loginEmail,
            passwordHash: await hashPassword(body.createLogin.password),
            role: body.createLogin.role,
            employeeId: employee._id,
            isActive: true,
            lastLoginAt: null,
            refreshTokenHash: null,
            refreshTokenExpiresAt: null,
            createdBy: ctx.account.userId ? toId(ctx.account.userId) : null,
            isDeleted: false,
          },
        ],
        { session },
      );
    }

    // 6. Initialize Leave Balances
    await initializeEmployeeBalances(
      employee._id,
      employee.dateOfJoining,
      employee.employmentType,
      undefined,
      session,
    );

    // 7. Auto-create Onboarding record with 14 items
    await createOnboardingForEmployee(employee, session);

    // 8. Update Candidate record
    candidate.stage = 'Joined';
    candidate.convertedEmployeeId = employee._id;
    candidate.stageHistory.push({
      stage: 'Joined',
      changedAt: new Date(),
      changedBy: ctx.account.userId ? toId(ctx.account.userId) : null,
      note: `Converted to employee ${employeeCode}`,
    });
    await candidate.save({ session });

    // 9. Audit records
    await recordAudit({
      actorId: ctx.account.userId,
      action: 'candidate.converted',
      entityType: 'Candidate',
      entityId: candidate._id,
      after: {
        candidateCode: candidate.candidateCode,
        employeeId: employee._id.toString(),
        employeeCode,
      },
      ip: ctx.ip,
    });

    await recordAudit({
      actorId: ctx.account.userId,
      action: 'employee.created',
      entityType: 'Employee',
      entityId: employee._id,
      after: {
        employeeCode,
        email: candidate.email,
        employmentType: body.employmentType,
        status,
        convertedFromCandidate: candidate.candidateCode,
      },
      ip: ctx.ip,
    });

    await session.commitTransaction();

    await invalidateDashboardCache();

    return {
      candidateId: candidate._id.toString(),
      candidateCode: candidate.candidateCode,
      employeeId: employee._id.toString(),
      employeeCode,
      jobId: job._id.toString(),
      jobCode: job.jobCode,
      filledCount: job.filledCount,
      openings: job.openings,
    };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}
