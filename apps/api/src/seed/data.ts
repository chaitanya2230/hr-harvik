import type { EmployeeStatus, EmploymentType, Role } from '../config/constants';
import { DEMO_PASSWORD } from '../modules/auth/auth.schema';

/**
 * AGENTS.md §12 — development/testing fixtures only.
 *
 * P0 seeds what the foundation needs to be exercised: the four demo logins,
 * the five departments, and a reporting hierarchy three levels deep so that
 * manager team-scoping (AGENTS.md §6) can be tested. Recruitment, assets,
 * licences, documents, attendance and exit fixtures are added by the phase
 * that owns them.
 */

export const DEMO_USERS: ReadonlyArray<{ email: string; role: Role; employeeKey: string }> = [
  { email: 'admin@harviktech.com', role: 'HR Admin', employeeKey: 'meera' },
  { email: 'hrmanager@harviktech.com', role: 'HR Manager', employeeKey: 'vikram' },
  { email: 'manager@harviktech.com', role: 'Manager', employeeKey: 'ananya' },
  { email: 'employee@harviktech.com', role: 'Employee', employeeKey: 'sneha' },
];

export const DEPARTMENTS = ['Engineering', 'Design', 'HR', 'Finance', 'Sales'] as const;

export interface SeedEmployee {
  /** Stable local key used to wire `reportingManagerId` and `employeeId`. */
  key: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dob: string;
  designation: string;
  department: (typeof DEPARTMENTS)[number];
  employmentType: EmploymentType;
  dateOfJoining: string;
  probationEndDate?: string;
  status: EmployeeStatus;
  managerKey?: string;
  compensation: {
    amount: number;
    currency: string;
    period: 'monthly' | 'hourly' | 'fixed';
  };
}

export const EMPLOYEES: readonly SeedEmployee[] = [
  {
    key: 'meera',
    firstName: 'Meera',
    lastName: 'Raghavan',
    email: 'meera.raghavan@harviktech.com',
    phone: '+91 98000 10001',
    dob: '1988-04-12',
    designation: 'Head of People',
    department: 'HR',
    employmentType: 'Full-Time',
    dateOfJoining: '2019-02-04',
    status: 'Active',
    compensation: { amount: 185000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'vikram',
    firstName: 'Vikram',
    lastName: 'Nair',
    email: 'vikram.nair@harviktech.com',
    phone: '+91 98000 10002',
    dob: '1990-09-03',
    designation: 'HR Business Partner',
    department: 'HR',
    employmentType: 'Full-Time',
    dateOfJoining: '2020-07-13',
    status: 'Active',
    managerKey: 'meera',
    compensation: { amount: 95000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'ananya',
    firstName: 'Ananya',
    lastName: 'Iyer',
    email: 'ananya.iyer@harviktech.com',
    phone: '+91 98000 10003',
    dob: '1989-01-27',
    designation: 'Engineering Manager',
    department: 'Engineering',
    employmentType: 'Full-Time',
    dateOfJoining: '2018-11-05',
    status: 'Active',
    managerKey: 'vikram',
    compensation: { amount: 165000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'rahul',
    firstName: 'Rahul',
    lastName: 'Verma',
    email: 'rahul.verma@harviktech.com',
    phone: '+91 98000 10004',
    dob: '1993-06-18',
    designation: 'Senior Software Engineer',
    department: 'Engineering',
    employmentType: 'Full-Time',
    dateOfJoining: '2021-03-08',
    status: 'Active',
    managerKey: 'ananya',
    compensation: { amount: 115000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'sneha',
    firstName: 'Sneha',
    lastName: 'Patil',
    email: 'sneha.patil@harviktech.com',
    phone: '+91 98000 10005',
    dob: '1998-11-30',
    designation: 'Software Engineer',
    department: 'Engineering',
    employmentType: 'Full-Time',
    dateOfJoining: '2025-09-01',
    probationEndDate: '2026-03-01',
    status: 'Probation',
    managerKey: 'rahul',
    compensation: { amount: 72000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'rohit',
    firstName: 'Rohit',
    lastName: 'Bansal',
    email: 'rohit.bansal@harviktech.com',
    phone: '+91 98000 10006',
    dob: '1995-02-14',
    designation: 'QA Engineer',
    department: 'Engineering',
    employmentType: 'Contractor',
    dateOfJoining: '2022-08-22',
    status: 'Active',
    managerKey: 'ananya',
    compensation: { amount: 850, currency: 'INR', period: 'hourly' },
  },
  {
    key: 'naveen',
    firstName: 'Naveen',
    lastName: 'Joshi',
    email: 'naveen.joshi@harviktech.com',
    phone: '+91 98000 10007',
    dob: '1991-12-05',
    designation: 'Technical Consultant',
    department: 'Engineering',
    employmentType: 'Freelancer',
    dateOfJoining: '2023-01-09',
    status: 'Active',
    managerKey: 'ananya',
    compensation: { amount: 140000, currency: 'INR', period: 'fixed' },
  },
  {
    key: 'karan',
    firstName: 'Karan',
    lastName: 'Malhotra',
    email: 'karan.malhotra@harviktech.com',
    phone: '+91 98000 10008',
    dob: '1992-07-21',
    designation: 'Product Designer',
    department: 'Design',
    employmentType: 'Full-Time',
    dateOfJoining: '2021-10-11',
    status: 'Active',
    managerKey: 'ananya',
    compensation: { amount: 98000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'dev',
    firstName: 'Dev',
    lastName: 'Sharma',
    email: 'dev.sharma@harviktech.com',
    phone: '+91 98000 10009',
    dob: '2005-05-16',
    designation: 'Design Intern',
    department: 'Design',
    employmentType: 'Intern',
    dateOfJoining: '2026-01-05',
    probationEndDate: '2026-07-05',
    status: 'Probation',
    managerKey: 'karan',
    compensation: { amount: 15000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'ishita',
    firstName: 'Ishita',
    lastName: 'Rao',
    email: 'ishita.rao@harviktech.com',
    phone: '+91 98000 10010',
    dob: '1994-03-09',
    designation: 'Finance Analyst',
    department: 'Finance',
    employmentType: 'Full-Time',
    dateOfJoining: '2022-04-18',
    status: 'Active',
    managerKey: 'meera',
    compensation: { amount: 82000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'pooja',
    firstName: 'Pooja',
    lastName: 'Menon',
    email: 'pooja.menon@harviktech.com',
    phone: '+91 98000 10011',
    dob: '1996-08-23',
    designation: 'Sales Executive',
    department: 'Sales',
    employmentType: 'Freelancer',
    dateOfJoining: '2023-09-04',
    status: 'Active',
    managerKey: 'meera',
    compensation: { amount: 65000, currency: 'INR', period: 'monthly' },
  },
];

/** Never logged — only referenced from README/AGENTS docs. */
export const DEMO_PASSWORD_VALUE = DEMO_PASSWORD;