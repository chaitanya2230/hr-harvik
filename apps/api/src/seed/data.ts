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
  /** Set for On Notice / Relieved fixtures (§12 exit demo data). */
  lastWorkingDay?: string;
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
    managerKey: 'ananya',
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
  {
    key: 'arjun',
    firstName: 'Arjun',
    lastName: 'Shetty',
    email: 'arjun.shetty@harviktech.com',
    phone: '+91 98000 10012',
    dob: '1994-05-17',
    designation: 'Software Engineer',
    department: 'Engineering',
    employmentType: 'Full-Time',
    dateOfJoining: '2024-06-10',
    status: 'Active',
    managerKey: 'rahul',
    compensation: { amount: 88000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'kavya',
    firstName: 'Kavya',
    lastName: 'Reddy',
    email: 'kavya.reddy@harviktech.com',
    phone: '+91 98000 10013',
    dob: '1997-02-08',
    designation: 'UI Designer',
    department: 'Design',
    employmentType: 'Full-Time',
    dateOfJoining: '2024-09-02',
    status: 'Active',
    managerKey: 'karan',
    compensation: { amount: 76000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'aditi',
    firstName: 'Aditi',
    lastName: 'Kulkarni',
    email: 'aditi.kulkarni@harviktech.com',
    phone: '+91 98000 10014',
    dob: '2007-05-20',
    designation: 'Engineering Intern',
    department: 'Engineering',
    employmentType: 'Intern',
    dateOfJoining: '2026-01-12',
    probationEndDate: '2026-07-12',
    status: 'Probation',
    managerKey: 'rahul',
    compensation: { amount: 18000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'farhan',
    firstName: 'Farhan',
    lastName: 'Khan',
    email: 'farhan.khan@harviktech.com',
    phone: '+91 98000 10015',
    dob: '1991-10-03',
    designation: 'DevOps Contractor',
    department: 'Engineering',
    employmentType: 'Contractor',
    dateOfJoining: '2025-04-07',
    status: 'Active',
    managerKey: 'ananya',
    compensation: { amount: 950, currency: 'INR', period: 'hourly' },
  },
  {
    key: 'gita',
    firstName: 'Gita',
    lastName: 'Nair',
    email: 'gita.nair@harviktech.com',
    phone: '+91 98000 10016',
    dob: '1995-12-19',
    designation: 'Content Strategist',
    department: 'Sales',
    employmentType: 'Freelancer',
    dateOfJoining: '2024-02-05',
    status: 'Active',
    managerKey: 'meera',
    compensation: { amount: 55000, currency: 'INR', period: 'fixed' },
  },
  {
    key: 'harish',
    firstName: 'Harish',
    lastName: 'Menon',
    email: 'harish.menon@harviktech.com',
    phone: '+91 98000 10017',
    dob: '1989-07-25',
    designation: 'Senior Finance Analyst',
    department: 'Finance',
    employmentType: 'Full-Time',
    dateOfJoining: '2021-08-16',
    status: 'Active',
    managerKey: 'meera',
    compensation: { amount: 105000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'isha',
    firstName: 'Isha',
    lastName: 'Gupta',
    email: 'isha.gupta@harviktech.com',
    phone: '+91 98000 10018',
    dob: '1996-03-14',
    designation: 'HR Executive',
    department: 'HR',
    employmentType: 'Full-Time',
    dateOfJoining: '2023-05-22',
    status: 'Active',
    managerKey: 'vikram',
    compensation: { amount: 68000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'jatin',
    firstName: 'Jatin',
    lastName: 'Shah',
    email: 'jatin.shah@harviktech.com',
    phone: '+91 98000 10019',
    dob: '1999-09-09',
    designation: 'Support Specialist',
    department: 'Engineering',
    employmentType: 'Other',
    dateOfJoining: '2023-11-06',
    status: 'Active',
    managerKey: 'rahul',
    compensation: { amount: 45000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'kiran',
    firstName: 'Kiran',
    lastName: 'Das',
    email: 'kiran.das@harviktech.com',
    phone: '+91 98000 10020',
    dob: '2006-11-30',
    designation: 'Design Intern',
    department: 'Design',
    employmentType: 'Intern',
    dateOfJoining: '2026-02-02',
    probationEndDate: '2026-08-02',
    status: 'Probation',
    managerKey: 'karan',
    compensation: { amount: 15000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'lakshmi',
    firstName: 'Lakshmi',
    lastName: 'Venkat',
    email: 'lakshmi.venkat@harviktech.com',
    phone: '+91 98000 10021',
    dob: '1992-06-11',
    designation: 'Account Executive',
    department: 'Sales',
    employmentType: 'Full-Time',
    dateOfJoining: '2021-04-12',
    status: 'On Notice',
    lastWorkingDay: '2026-11-02',
    managerKey: 'meera',
    compensation: { amount: 90000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'manoj',
    firstName: 'Manoj',
    lastName: 'Tiwari',
    email: 'manoj.tiwari@harviktech.com',
    phone: '+91 98000 10022',
    dob: '1990-01-29',
    designation: 'QA Lead',
    department: 'Engineering',
    employmentType: 'Full-Time',
    dateOfJoining: '2020-09-14',
    status: 'On Notice',
    lastWorkingDay: '2026-10-27',
    managerKey: 'ananya',
    compensation: { amount: 110000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'neha',
    firstName: 'Neha',
    lastName: 'Chopra',
    email: 'neha.chopra@harviktech.com',
    phone: '+91 98000 10023',
    dob: '1993-04-02',
    designation: 'Finance Executive',
    department: 'Finance',
    employmentType: 'Full-Time',
    dateOfJoining: '2021-02-01',
    status: 'Relieved',
    lastWorkingDay: '2026-08-14',
    managerKey: 'meera',
    compensation: { amount: 78000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'omprakash',
    firstName: 'Omprakash',
    lastName: 'Reddy',
    email: 'omprakash.reddy@harviktech.com',
    phone: '+91 98000 10024',
    dob: '1995-08-16',
    designation: 'Backend Engineer',
    department: 'Engineering',
    employmentType: 'Full-Time',
    dateOfJoining: '2024-03-11',
    status: 'Active',
    managerKey: 'rahul',
    compensation: { amount: 92000, currency: 'INR', period: 'monthly' },
  },
  {
    key: 'priya',
    firstName: 'Priya',
    lastName: 'Nambiar',
    email: 'priya.nambiar@harviktech.com',
    phone: '+91 98000 10025',
    dob: '1998-12-05',
    designation: 'Junior Designer',
    department: 'Design',
    employmentType: 'Full-Time',
    dateOfJoining: '2026-09-20',
    probationEndDate: '2027-03-20',
    status: 'Probation',
    managerKey: 'karan',
    compensation: { amount: 58000, currency: 'INR', period: 'monthly' },
  },
];

/** Never logged — only referenced from README/AGENTS docs. */
export const DEMO_PASSWORD_VALUE = DEMO_PASSWORD;

// ---------------------------------------------------------------------------
// P2 fixtures (AGENTS.md §12): ~30 assets, ~8 licenses, assignments, access.
// ---------------------------------------------------------------------------

export interface SeedAsset {
  name: string;
  type: string;
  brand?: string;
  model?: string;
  serial: string;
  purchaseDate: string;
  purchaseCost: number;
  condition?: string;
  /** Non-Available resting state for unassigned fixtures (D-29). */
  status?: 'Under Repair' | 'Lost' | 'Damaged' | 'Returned' | 'Retired';
  /** Seed employee key holding this asset. */
  assigneeKey?: string;
  expectedReturnDate?: string;
}

export const ASSETS: readonly SeedAsset[] = [
  { name: 'MacBook Pro 14', type: 'Laptop', brand: 'Apple', model: 'M3 Pro', serial: 'SN-MBP14-001', purchaseDate: '2024-01-15', purchaseCost: 199900, condition: 'New', assigneeKey: 'rahul' },
  { name: 'MacBook Air 13', type: 'Laptop', brand: 'Apple', model: 'M2', serial: 'SN-MBA13-002', purchaseDate: '2024-03-20', purchaseCost: 114900, condition: 'New', assigneeKey: 'sneha' },
  { name: 'Dell XPS 15', type: 'Laptop', brand: 'Dell', model: 'XPS 15 9530', serial: 'SN-DXPS15-003', purchaseDate: '2023-06-10', purchaseCost: 145000, condition: 'Good', assigneeKey: 'rohit', expectedReturnDate: '2027-06-30' },
  { name: 'ThinkPad T14', type: 'Laptop', brand: 'Lenovo', model: 'T14 Gen 4', serial: 'SN-TPT14-004', purchaseDate: '2023-09-05', purchaseCost: 98000, condition: 'Good', assigneeKey: 'naveen' },
  { name: 'MacBook Pro 16', type: 'Laptop', brand: 'Apple', model: 'M3 Max', serial: 'SN-MBP16-005', purchaseDate: '2024-02-01', purchaseCost: 249900, condition: 'New', assigneeKey: 'karan' },
  { name: 'Dell Latitude 5440', type: 'Laptop', brand: 'Dell', model: 'Latitude 5440', serial: 'SN-DL54-006', purchaseDate: '2023-11-12', purchaseCost: 87000, condition: 'Good' },
  { name: 'HP EliteDesk 800', type: 'Desktop', brand: 'HP', model: 'EliteDesk 800 G9', serial: 'SN-HPED-007', purchaseDate: '2022-08-22', purchaseCost: 64000, condition: 'Fair', assigneeKey: 'ishita' },
  { name: 'Custom Build Ryzen 9', type: 'Desktop', brand: 'Custom', model: 'Ryzen 9 7950X', serial: 'SN-CBRZ-008', purchaseDate: '2023-04-17', purchaseCost: 120000, condition: 'Good' },
  { name: 'LG UltraFine 27', type: 'Monitor', brand: 'LG', model: '27UN850', serial: 'SN-LG27-009', purchaseDate: '2024-01-15', purchaseCost: 42000, condition: 'New', assigneeKey: 'rahul' },
  { name: 'Dell U2723QE', type: 'Monitor', brand: 'Dell', model: 'U2723QE', serial: 'SN-DU27-010', purchaseDate: '2023-12-01', purchaseCost: 48000, condition: 'Good' },
  { name: 'Samsung 24 inch', type: 'Monitor', brand: 'Samsung', model: 'S24C310', serial: 'SN-SS24-011', purchaseDate: '2023-05-30', purchaseCost: 14000, condition: 'Fair' },
  { name: 'Logitech MX Keys', type: 'Keyboard', brand: 'Logitech', model: 'MX Keys', serial: 'SN-LMK-012', purchaseDate: '2024-03-20', purchaseCost: 9500, condition: 'New', assigneeKey: 'sneha' },
  { name: 'Keychron K8', type: 'Keyboard', brand: 'Keychron', model: 'K8 Pro', serial: 'SN-KK8-013', purchaseDate: '2023-10-08', purchaseCost: 8500, condition: 'Good' },
  { name: 'Logitech MX Master 3S', type: 'Mouse', brand: 'Logitech', model: 'MX Master 3S', serial: 'SN-LMM-014', purchaseDate: '2024-01-15', purchaseCost: 7500, condition: 'New', assigneeKey: 'rahul' },
  { name: 'Apple Magic Mouse', type: 'Mouse', brand: 'Apple', model: 'Magic Mouse 2', serial: 'SN-AMM-015', purchaseDate: '2023-07-19', purchaseCost: 6500, condition: 'Good' },
  { name: 'Sony WH-1000XM5', type: 'Headphones', brand: 'Sony', model: 'WH-1000XM5', serial: 'SN-SWH-016', purchaseDate: '2024-02-01', purchaseCost: 26000, condition: 'New', assigneeKey: 'karan' },
  { name: 'AirPods Pro 2', type: 'Headphones', brand: 'Apple', model: 'AirPods Pro 2', serial: 'SN-APP-017', purchaseDate: '2023-12-15', purchaseCost: 18000, condition: 'Good' },
  { name: 'iPhone 14', type: 'Mobile Phone', brand: 'Apple', model: 'iPhone 14', serial: 'SN-IP14-018', purchaseDate: '2023-02-04', purchaseCost: 70000, condition: 'Fair', assigneeKey: 'meera' },
  { name: 'Pixel 8', type: 'Mobile Phone', brand: 'Google', model: 'Pixel 8', serial: 'SN-PX8-019', purchaseDate: '2024-04-11', purchaseCost: 62000, condition: 'New' },
  { name: 'ID Card - Rahul Verma', type: 'ID Card', serial: 'SN-ID-020', purchaseDate: '2021-03-08', purchaseCost: 200, condition: 'Good', assigneeKey: 'rahul' },
  { name: 'ID Card - Sneha Patil', type: 'ID Card', serial: 'SN-ID-021', purchaseDate: '2025-09-01', purchaseCost: 200, condition: 'New', assigneeKey: 'sneha' },
  { name: 'Wacom Intuos Pro', type: 'Other', brand: 'Wacom', model: 'Intuos Pro M', serial: 'SN-WC-022', purchaseDate: '2024-05-16', purchaseCost: 28000, condition: 'New', assigneeKey: 'dev', expectedReturnDate: '2027-01-05' },
  { name: 'Jabra Evolve2 65', type: 'Headphones', brand: 'Jabra', model: 'Evolve2 65', serial: 'SN-JB-023', purchaseDate: '2023-09-04', purchaseCost: 22000, condition: 'Good', assigneeKey: 'pooja', expectedReturnDate: '2027-06-30' },
  { name: 'Lenovo ThinkVision 27', type: 'Monitor', brand: 'Lenovo', model: 'ThinkVision P27', serial: 'SN-LTV-024', purchaseDate: '2023-08-14', purchaseCost: 32000, condition: 'Good' },
  { name: 'Dell Dock WD19', type: 'Other', brand: 'Dell', model: 'WD19S', serial: 'SN-DDW-025', purchaseDate: '2023-11-12', purchaseCost: 16000, condition: 'Good' },
  { name: 'Old MacBook 2019', type: 'Laptop', brand: 'Apple', model: 'MacBook Pro 2019', serial: 'SN-OMB-026', purchaseDate: '2019-06-01', purchaseCost: 150000, condition: 'Fair', status: 'Under Repair' },
  { name: 'Cracked Dell Monitor', type: 'Monitor', brand: 'Dell', model: 'P2419H', serial: 'SN-CDM-027', purchaseDate: '2020-03-11', purchaseCost: 18000, condition: 'Damaged', status: 'Damaged' },
  { name: 'Retired ThinkPad X1', type: 'Laptop', brand: 'Lenovo', model: 'X1 Carbon Gen 7', serial: 'SN-RTP-028', purchaseDate: '2019-09-23', purchaseCost: 130000, condition: 'Fair', status: 'Retired' },
  { name: 'Lost Logitech Mouse', type: 'Mouse', brand: 'Logitech', model: 'M185', serial: 'SN-LLM-029', purchaseDate: '2022-01-17', purchaseCost: 1200, condition: 'Good', status: 'Lost' },
  { name: 'Spare Keyboard', type: 'Keyboard', brand: 'Dell', model: 'KB216', serial: 'SN-SKB-030', purchaseDate: '2023-02-28', purchaseCost: 1500, condition: 'Good', status: 'Returned' },
  { name: 'ThinkPad E14', type: 'Laptop', brand: 'Lenovo', model: 'E14 Gen 5', serial: 'SN-TPE14-031', purchaseDate: '2024-07-08', purchaseCost: 72000, condition: 'Good', assigneeKey: 'omprakash' },
  { name: 'Dell P2422H', type: 'Monitor', brand: 'Dell', model: 'P2422H', serial: 'SN-DP24-032', purchaseDate: '2024-07-08', purchaseCost: 19000, condition: 'Good', assigneeKey: 'omprakash' },
];

export interface SeedLicense {
  softwareName: string;
  licenseType: string;
  licenseKey?: string;
  provider?: string;
  cost?: number;
  currency?: string;
  billingCycle?: string;
  startDate: string;
  /** 'expired' | 'near' | ISO date — resolved against today at seed time. */
  renewal: 'expired' | 'near' | string;
  maxSeats: number;
  status?: 'Available' | 'Expired';
  assigneeKeys?: string[];
}

export const LICENSES: readonly SeedLicense[] = [
  { softwareName: 'GitHub Team', licenseType: 'Per-Seat', licenseKey: 'ghp_seed_demo_key_001', provider: 'GitHub', cost: 2400, currency: 'INR', billingCycle: 'monthly', startDate: '2023-01-01', renewal: '2027-01-01', maxSeats: 15, assigneeKeys: ['rahul', 'sneha', 'naveen', 'omprakash'] },
  { softwareName: 'Google Workspace', licenseType: 'Per-Seat', provider: 'Google', cost: 18000, currency: 'INR', billingCycle: 'monthly', startDate: '2022-06-01', renewal: '2027-06-01', maxSeats: 25, assigneeKeys: ['meera', 'vikram', 'ananya', 'ishita', 'pooja'] },
  { softwareName: 'Slack Pro', licenseType: 'Per-Seat', licenseKey: 'xoxp-seed-demo-key-002', provider: 'Slack', cost: 9000, currency: 'INR', billingCycle: 'monthly', startDate: '2023-03-01', renewal: '2027-03-01', maxSeats: 20, assigneeKeys: ['rahul', 'karan', 'omprakash'] },
  { softwareName: 'Figma Professional', licenseType: 'Per-Seat', provider: 'Figma', cost: 12000, currency: 'INR', billingCycle: 'monthly', startDate: '2023-08-01', renewal: '2027-02-01', maxSeats: 5, assigneeKeys: ['karan', 'dev', 'omprakash'] },
  { softwareName: 'JetBrains All Products', licenseType: 'Per-Seat', provider: 'JetBrains', cost: 60000, currency: 'INR', billingCycle: 'yearly', startDate: '2024-01-01', renewal: '2027-01-01', maxSeats: 10, assigneeKeys: ['rahul'] },
  { softwareName: 'Zoom Business', licenseType: 'Per-Seat', provider: 'Zoom', cost: 15000, currency: 'INR', billingCycle: 'yearly', startDate: '2024-06-01', renewal: 'near', maxSeats: 10, assigneeKeys: ['ananya'] },
  { softwareName: 'AWS Organization', licenseType: 'Site', provider: 'Amazon', cost: 50000, currency: 'INR', billingCycle: 'monthly', startDate: '2022-01-01', renewal: '2027-01-01', maxSeats: 100, assigneeKeys: ['naveen'] },
  { softwareName: 'Legacy CRM', licenseType: 'Single-User', provider: 'OldVendor', cost: 30000, currency: 'INR', billingCycle: 'yearly', startDate: '2020-01-01', renewal: 'expired', maxSeats: 1, status: 'Expired' },
];

export interface SeedAccessItem {
  employeeKey: string;
  system: string;
  identifier?: string;
  /** License software name whose assignment this access is linked to. */
  linkedLicense?: string;
}

export const ACCESS_ITEMS: readonly SeedAccessItem[] = [
  { employeeKey: 'rahul', system: 'GitHub org', identifier: 'rahul-verma', linkedLicense: 'GitHub Team' },
  { employeeKey: 'sneha', system: 'Google Workspace', identifier: 'sneha.patil@harviktech.com' },
  { employeeKey: 'karan', system: 'Slack', identifier: '@karan', linkedLicense: 'Slack Pro' },
  { employeeKey: 'rohit', system: 'VPN', identifier: 'rohit.vpn' },
  { employeeKey: 'omprakash', system: 'GitHub org', identifier: 'omprakash-reddy' },
];

export interface SeedDocumentTemplate {
  name: string;
  category: string;
  applicableEmploymentTypes: string[];
  bodyHtml: string;
}

export const DOCUMENT_TEMPLATES: readonly SeedDocumentTemplate[] = [
  {
    name: 'Full-Time Employment Offer',
    category: 'Offer Letter',
    applicableEmploymentTypes: ['Full-Time'],
    bodyHtml: `<h2>OFFER OF EMPLOYMENT</h2>
<p>Dear {{employee.firstName}} {{employee.lastName}},</p>
<p>We are delighted to offer you the position of <strong>{{employee.designation}}</strong> at <strong>{{company.name}}</strong>. We were very impressed by your background and skills and believe you will make a great addition to our team.</p>
<p>Your employment will commence on <strong>{{employee.dateOfJoining}}</strong>. You will report to the department head in <strong>{{employee.department}}</strong>.</p>
<hr />
<h3>Terms of Employment:</h3>
<p><strong>Designation:</strong> {{employee.designation}}</p>
<p><strong>Employment Type:</strong> {{employee.employmentType}}</p>
<p><strong>Joining Date:</strong> {{employee.dateOfJoining}}</p>
<hr />
<p>Please confirm your acceptance of this offer by signing and returning a copy of this letter.</p>
<p>Sincerely,</p>
<p>{{company.name}} HR Operations</p>`,
  },
  {
    name: 'Internship Offer Letter',
    category: 'Offer Letter',
    applicableEmploymentTypes: ['Intern'],
    bodyHtml: `<h2>INTERNSHIP OFFER LETTER</h2>
<p>Dear {{employee.firstName}} {{employee.lastName}},</p>
<p>On behalf of <strong>{{company.name}}</strong>, we are pleased to offer you an internship position as <strong>{{employee.designation}}</strong>.</p>
<p>Your internship will begin on <strong>{{employee.dateOfJoining}}</strong> in the <strong>{{employee.department}}</strong> department.</p>
<hr />
<p>During your internship, you will have the opportunity to gain practical experience, collaborate on production engineering initiatives, and work under senior mentorship.</p>
<p>Welcome to the team!</p>`,
  },
  {
    name: 'Standard Non-Disclosure Agreement (NDA)',
    category: 'NDA',
    applicableEmploymentTypes: ['Full-Time', 'Intern', 'Freelancer', 'Contractor', 'Other'],
    bodyHtml: `<h2>NON-DISCLOSURE AND CONFIDENTIALITY AGREEMENT</h2>
<p>This Non-Disclosure Agreement ("Agreement") is entered into as of <strong>{{today}}</strong> by and between <strong>{{company.name}}</strong> and <strong>{{employee.fullName}}</strong> (Employee Code: {{employee.employeeCode}}).</p>
<p>The Employee agrees that all proprietary technical information, source code, customer data, and business strategies disclosed during their engagement remain the exclusive property of {{company.name}}.</p>
<p>The Employee shall maintain strict confidentiality during and following the tenure of employment.</p>`,
  },
  {
    name: 'Experience Certificate',
    category: 'Experience Certificate',
    applicableEmploymentTypes: ['Full-Time', 'Intern', 'Freelancer', 'Contractor', 'Other'],
    bodyHtml: `<h2>EXPERIENCE CERTIFICATE</h2>
<p>TO WHOMSOEVER IT MAY CONCERN</p>
<p>This is to certify that <strong>{{employee.fullName}}</strong> (Employee Code: {{employee.employeeCode}}) was employed with <strong>{{company.name}}</strong> as <strong>{{employee.designation}}</strong> from <strong>{{employee.dateOfJoining}}</strong>.</p>
<p>During their tenure with us, they demonstrated strong technical proficiency, professional integrity, and exemplary dedication.</p>
<p>We wish them every success in all future professional endeavors.</p>`,
  },
  {
    name: 'Relieving Letter',
    category: 'Relieving Letter',
    applicableEmploymentTypes: ['Full-Time', 'Intern', 'Freelancer', 'Contractor', 'Other'],
    bodyHtml: `<h2>RELIEVING LETTER</h2>
<p>Date: {{today}}</p>
<p>Dear {{employee.fullName}},</p>
<p>This has reference to your resignation from the services of <strong>{{company.name}}</strong>. We confirm that you have been relieved from your duties as <strong>{{employee.designation}}</strong> effective the close of business.</p>
<p>All company assets and clearances have been completed in accordance with offboarding protocol.</p>
<p>We thank you for your contributions and wish you the best in your future career.</p>`,
  },
  {
    name: 'Freelance Agreement',
    category: 'Agreement',
    applicableEmploymentTypes: ['Freelancer', 'Contractor', 'Other'],
    bodyHtml: `<h2>FREELANCE SERVICES AGREEMENT</h2>
<p>This agreement is entered into as of <strong>{{today}}</strong> by and between <strong>{{company.name}}</strong> and <strong>{{employee.fullName}}</strong> ({{employee.employeeCode}}).</p>
<p><strong>{{employee.fullName}}</strong> shall provide services as <strong>{{employee.designation}}</strong> commencing <strong>{{employee.dateOfJoining}}</strong>. Compensation terms are documented separately by Finance.</p>
<p>Either party may terminate this engagement with written notice as per company policy.</p>`,
  },
  {
    name: 'Employment Agreement',
    category: 'Agreement',
    applicableEmploymentTypes: ['Full-Time'],
    bodyHtml: `<h2>EMPLOYMENT AGREEMENT</h2>
<p>This Employment Agreement is made as of <strong>{{today}}</strong> between <strong>{{company.name}}</strong> and <strong>{{employee.fullName}}</strong> ({{employee.employeeCode}}).</p>
<p>The Employee is appointed as <strong>{{employee.designation}}</strong> in the <strong>{{employee.department}}</strong> department effective <strong>{{employee.dateOfJoining}}</strong>.</p>
<p>The Employee agrees to abide by all company policies, confidentiality obligations, and the code of conduct.</p>`,
  },
  {
    name: 'Salary Appraisal Letter',
    category: 'Appraisal',
    applicableEmploymentTypes: ['Full-Time'],
    bodyHtml: `<h2>SALARY APPRAISAL LETTER</h2>
<p>Date: {{today}}</p>
<p>Dear {{employee.fullName}},</p>
<p>We are pleased to inform you that your compensation has been revised in recognition of your contributions as <strong>{{employee.designation}}</strong>.</p>
<p>Your revised compensation is <strong>{{employee.compensation.amount}} {{employee.compensation.currency}}</strong> ({{employee.compensation.period}}).</p>
<p>All other terms of your employment remain unchanged.</p>`,
  },
  {
    name: 'General HR Letter',
    category: 'Other',
    applicableEmploymentTypes: ['Full-Time', 'Intern', 'Freelancer', 'Contractor', 'Other'],
    bodyHtml: `<h2>{{company.name}} — HR CORRESPONDENCE</h2>
<p>Date: {{today}}</p>
<p>Dear {{employee.fullName}} ({{employee.employeeCode}}),</p>
<p>This letter confirms your association with <strong>{{company.name}}</strong> as <strong>{{employee.designation}}</strong> since <strong>{{employee.dateOfJoining}}</strong>.</p>`,
  },
];

export const LEAVE_TYPES = [
  {
    name: 'Casual Leave',
    code: 'CASUAL',
    annualAllocation: 12,
    carryForward: false,
    maxCarryForward: 0,
    isPaid: true,
    requiresDocument: false,
    applicableEmploymentTypes: ['Full-Time', 'Intern', 'Contractor', 'Other'],
  },
  {
    name: 'Sick Leave',
    code: 'SICK',
    annualAllocation: 10,
    carryForward: false,
    maxCarryForward: 0,
    isPaid: true,
    requiresDocument: true,
    applicableEmploymentTypes: ['Full-Time'],
  },
  {
    name: 'Earned Leave',
    code: 'EARNED',
    annualAllocation: 15,
    carryForward: true,
    maxCarryForward: 10,
    isPaid: true,
    requiresDocument: false,
    applicableEmploymentTypes: ['Full-Time'],
  },
  {
    name: 'Unpaid Leave',
    code: 'UNPAID',
    annualAllocation: 0,
    carryForward: false,
    maxCarryForward: 0,
    isPaid: false,
    requiresDocument: false,
    applicableEmploymentTypes: ['Full-Time', 'Intern', 'Freelancer', 'Contractor', 'Other'],
  },
];

const currentYear = new Date().getUTCFullYear();
export const HOLIDAYS = [
  { date: `${currentYear}-01-01`, name: "New Year's Day" },
  { date: `${currentYear}-01-26`, name: 'Republic Day' },
  { date: `${currentYear}-05-01`, name: 'International Workers Day' },
  { date: `${currentYear}-08-15`, name: 'Independence Day' },
  { date: `${currentYear}-10-02`, name: 'Gandhi Jayanti' },
  { date: `${currentYear}-11-01`, name: 'Diwali' },
  { date: `${currentYear}-12-25`, name: 'Christmas Day' },
];

export interface SeedJob {
  key: string;
  title: string;
  department: (typeof DEPARTMENTS)[number];
  hiringManagerKey: string;
  openings: number;
  filledCount: number;
  description: string;
  requiredSkills: string[];
  openingDate: string;
  closingDate?: string | null;
  status: 'Draft' | 'Open' | 'On Hold' | 'Closed' | 'Filled';
}

export interface SeedCandidateInterview {
  round: number;
  title: string;
  interviewerKey: string;
  scheduledAt: string;
  status: 'Scheduled' | 'Completed' | 'Cancelled';
  feedback?: string | null;
  rating?: number | null;
  completedAt?: string | null;
}

export interface SeedCandidate {
  name: string;
  email: string;
  phone: string;
  jobKey: string;
  source: 'LinkedIn' | 'Referral' | 'Website' | 'Agency' | 'Other';
  stage: 'Applied' | 'Shortlisted' | 'Interview' | 'Selected' | 'Offer' | 'Joined' | 'Rejected';
  selectionStatus?: 'Pending' | 'Selected' | 'Rejected';
  offerStatus?: 'Pending' | 'Sent' | 'Accepted' | 'Declined';
  joiningDate?: string | null;
  rejectionReason?: string | null;
  convertedEmployeeKey?: string | null;
  interviews?: SeedCandidateInterview[];
}

export const SEED_JOBS: readonly SeedJob[] = [
  {
    key: 'senior-fullstack',
    title: 'Senior Full Stack Engineer',
    department: 'Engineering',
    hiringManagerKey: 'ananya',
    openings: 3,
    filledCount: 1,
    description: 'Looking for an experienced engineer with deep expertise in React, Node.js, and distributed MongoDB environments.',
    requiredSkills: ['React', 'Node.js', 'TypeScript', 'MongoDB'],
    openingDate: '2026-01-15',
    status: 'Open',
  },
  {
    key: 'product-designer',
    title: 'Product Designer (UI/UX)',
    department: 'Design',
    hiringManagerKey: 'ananya',
    openings: 1,
    filledCount: 0,
    description: 'Lead end-to-end user experience and interface architecture for core web application suites.',
    requiredSkills: ['Figma', 'Design Systems', 'User Research', 'Wireframing'],
    openingDate: '2026-02-01',
    status: 'Open',
  },
  {
    key: 'devops-engineer',
    title: 'DevOps & Cloud Engineer',
    department: 'Engineering',
    hiringManagerKey: 'ananya',
    openings: 1,
    filledCount: 1,
    description: 'Own CI/CD pipelines, container orchestration, Docker deployments, and AWS cloud reliability.',
    requiredSkills: ['Docker', 'Kubernetes', 'AWS', 'Terraform', 'CI/CD'],
    openingDate: '2025-11-01',
    closingDate: '2026-01-20',
    status: 'Filled',
  },
  {
    key: 'technical-recruiter',
    title: 'Technical Talent Specialist',
    department: 'HR',
    hiringManagerKey: 'meera',
    openings: 1,
    filledCount: 0,
    description: 'Manage full-cycle tech recruitment pipeline across engineering, product, and leadership functions.',
    requiredSkills: ['Technical Sourcing', 'LinkedIn Recruiter', 'Interview Coordination'],
    openingDate: '2026-03-01',
    status: 'Draft',
  },
  {
    key: 'growth-marketing',
    title: 'Growth Marketing Specialist',
    department: 'Sales',
    hiringManagerKey: 'ananya',
    openings: 2,
    filledCount: 0,
    description: 'Drive organic and paid user acquisition, technical SEO, and conversion optimization.',
    requiredSkills: ['SEO', 'Google Analytics', 'Content Strategy', 'B2B Marketing'],
    openingDate: '2026-01-20',
    status: 'On Hold',
  },
];

export const SEED_CANDIDATES: readonly SeedCandidate[] = [
  {
    name: 'Aarav Sharma',
    email: 'aarav.sharma@example.com',
    phone: '+91 99000 11001',
    jobKey: 'senior-fullstack',
    source: 'LinkedIn',
    stage: 'Applied',
  },
  {
    name: 'Bhavna Patel',
    email: 'bhavna.patel@example.com',
    phone: '+91 99000 11002',
    jobKey: 'product-designer',
    source: 'Website',
    stage: 'Applied',
  },
  {
    name: 'Chirag Gupta',
    email: 'chirag.gupta@example.com',
    phone: '+91 99000 11003',
    jobKey: 'senior-fullstack',
    source: 'Referral',
    stage: 'Shortlisted',
  },
  {
    name: 'Divya Rao',
    email: 'divya.rao@example.com',
    phone: '+91 99000 11004',
    jobKey: 'growth-marketing',
    source: 'LinkedIn',
    stage: 'Shortlisted',
  },
  {
    name: 'Eshan Malhotra',
    email: 'eshan.malhotra@example.com',
    phone: '+91 99000 11005',
    jobKey: 'senior-fullstack',
    source: 'LinkedIn',
    stage: 'Interview',
    interviews: [
      {
        round: 1,
        title: 'Screening Call',
        interviewerKey: 'ananya',
        scheduledAt: '2026-10-15T10:00:00.000Z',
        status: 'Scheduled',
      },
    ],
  },
  {
    name: 'Farhan Akhtar',
    email: 'farhan.akhtar@example.com',
    phone: '+91 99000 11006',
    jobKey: 'product-designer',
    source: 'Referral',
    stage: 'Interview',
    interviews: [
      {
        round: 1,
        title: 'Portfolio Review',
        interviewerKey: 'ananya',
        scheduledAt: '2026-10-02T14:00:00.000Z',
        status: 'Completed',
        feedback: 'Exceptional design system depth and Figma fluency.',
        rating: 5,
        completedAt: '2026-10-02T15:00:00.000Z',
      },
    ],
  },
  {
    name: 'Gayatri Menon',
    email: 'gayatri.menon@example.com',
    phone: '+91 99000 11007',
    jobKey: 'senior-fullstack',
    source: 'Agency',
    stage: 'Interview',
    interviews: [
      {
        round: 1,
        title: 'DSA & Systems',
        interviewerKey: 'ananya',
        scheduledAt: '2026-09-20T10:00:00.000Z',
        status: 'Completed',
        feedback: 'Strong algorithmic fundamentals and clean TypeScript architecture.',
        rating: 4,
        completedAt: '2026-09-20T11:00:00.000Z',
      },
      {
        round: 2,
        title: 'System Design',
        interviewerKey: 'rahul',
        scheduledAt: '2026-10-12T11:00:00.000Z',
        status: 'Scheduled',
      },
    ],
  },
  {
    name: 'Harish Pillai',
    email: 'harish.pillai@example.com',
    phone: '+91 99000 11008',
    jobKey: 'product-designer',
    source: 'LinkedIn',
    stage: 'Selected',
    selectionStatus: 'Selected',
  },
  {
    name: 'Ishaan Reddy',
    email: 'ishaan.reddy@example.com',
    phone: '+91 99000 11009',
    jobKey: 'senior-fullstack',
    source: 'Website',
    stage: 'Selected',
    selectionStatus: 'Selected',
  },
  {
    name: 'Jaya Swaminathan',
    email: 'jaya.swaminathan@example.com',
    phone: '+91 99000 11010',
    jobKey: 'senior-fullstack',
    source: 'Referral',
    stage: 'Offer',
    offerStatus: 'Sent',
    joiningDate: '2026-11-01',
  },
  {
    name: 'Karan Kapoor',
    email: 'karan.kapoor@example.com',
    phone: '+91 99000 11011',
    jobKey: 'growth-marketing',
    source: 'LinkedIn',
    stage: 'Offer',
    offerStatus: 'Accepted',
    joiningDate: '2026-10-20',
  },
  {
    name: 'Lavanya Joshi',
    email: 'lavanya.joshi@example.com',
    phone: '+91 99000 11012',
    jobKey: 'senior-fullstack',
    source: 'Other',
    stage: 'Offer',
    offerStatus: 'Declined',
  },
  {
    name: 'Manish Sen',
    email: 'manish.sen@example.com',
    phone: '+91 99000 11013',
    jobKey: 'devops-engineer',
    source: 'LinkedIn',
    stage: 'Joined',
    offerStatus: 'Accepted',
    convertedEmployeeKey: 'rahul',
  },
  {
    name: 'Neha Kulkarni',
    email: 'neha.kulkarni@example.com',
    phone: '+91 99000 11014',
    jobKey: 'technical-recruiter',
    source: 'Website',
    stage: 'Rejected',
    rejectionReason: 'Experience does not match high-growth tech sourcing scope',
  },
  {
    name: 'Omkar Deshmukh',
    email: 'omkar.deshmukh@example.com',
    phone: '+91 99000 11015',
    jobKey: 'senior-fullstack',
    source: 'Agency',
    stage: 'Rejected',
    rejectionReason: 'System architecture round did not meet seniority threshold',
  },
];