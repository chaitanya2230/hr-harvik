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
  { softwareName: 'GitHub Team', licenseType: 'Per-Seat', licenseKey: 'ghp_seed_demo_key_001', provider: 'GitHub', cost: 2400, currency: 'INR', billingCycle: 'monthly', startDate: '2023-01-01', renewal: '2027-01-01', maxSeats: 15, assigneeKeys: ['rahul', 'sneha', 'naveen'] },
  { softwareName: 'Google Workspace', licenseType: 'Per-Seat', provider: 'Google', cost: 18000, currency: 'INR', billingCycle: 'monthly', startDate: '2022-06-01', renewal: '2027-06-01', maxSeats: 25, assigneeKeys: ['meera', 'vikram', 'ananya', 'ishita', 'pooja'] },
  { softwareName: 'Slack Pro', licenseType: 'Per-Seat', licenseKey: 'xoxp-seed-demo-key-002', provider: 'Slack', cost: 9000, currency: 'INR', billingCycle: 'monthly', startDate: '2023-03-01', renewal: '2027-03-01', maxSeats: 20, assigneeKeys: ['rahul', 'karan'] },
  { softwareName: 'Figma Professional', licenseType: 'Per-Seat', provider: 'Figma', cost: 12000, currency: 'INR', billingCycle: 'monthly', startDate: '2023-08-01', renewal: '2027-02-01', maxSeats: 5, assigneeKeys: ['karan', 'dev'] },
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
];