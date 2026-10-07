import { describe, expect, it } from 'vitest';
import {
  renderTemplate,
  sanitizeTemplateHtml,
  type DocumentContext,
} from '../../src/modules/documents/pdf.service';

/**
 * AGENTS.md §14 DOCUMENTS — "unsafe HTML sanitized".
 *
 * Template preview HTML is rendered into the browser via
 * dangerouslySetInnerHTML, so employee-controlled values interpolated into a
 * template must never become executable markup. These tests pin the two-layer
 * defense in `renderTemplate`: default Handlebars escaping of every
 * `{{variable}}` plus post-render sanitization.
 */

const contextFor = (designation: string): DocumentContext => ({
  employee: {
    id: 'emp-1',
    employeeCode: 'HRV-0001',
    firstName: 'Sneha',
    lastName: 'Patil',
    email: 'sneha.patil@harviktech.com',
    phone: '+91 98000 10005',
    designation,
    department: 'Engineering',
    employmentType: 'Full-Time',
    dateOfJoining: '2025-09-01',
    status: 'Active',
    lastWorkingDay: null,
  },
  company: {
    name: 'Harvik Technologies',
    website: 'https://harviktech.com/',
    email: 'hr@harviktech.com',
  },
  today: '2026-10-07',
});

const TEMPLATE =
  '<h1>Offer Letter</h1><p>Dear {{employee.firstName}} {{employee.lastName}}, welcome as {{employee.designation}}.</p>';

describe('template XSS safety', () => {
  it('escapes script tags interpolated from employee-controlled values', () => {
    const html = renderTemplate(
      TEMPLATE,
      contextFor('Engineer <script>alert("xss")</script>'),
    );

    expect(html).not.toContain('<script');
    // The payload survives only as inert escaped text (proving we escape
    // rather than delete user content): no executable string remains.
    expect(html).toContain('alert(');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Dear Sneha Patil');
  });

  it('strips event-handler injection from interpolated values', () => {
    const html = renderTemplate(
      TEMPLATE,
      contextFor('Engineer <img src=x onerror=alert(1)>'),
    );

    expect(html).not.toContain('<img');
    // No executable attribute survives: only inert text may mention the name.
    expect(html).not.toMatch(/<[^>]*\bonerror\b/);
    expect(html).toContain('Engineer');
  });

  it('neutralizes raw triple-stash insertions via post-render sanitization', () => {
    const html = renderTemplate(
      '<p>Role: {{{employee.designation}}}</p>',
      contextFor('<svg onload=alert(2)>'),
    );

    expect(html).not.toContain('onload');
    expect(html).not.toContain('<svg');
  });

  it('preserves legitimate template formatting and benign values', () => {
    const html = renderTemplate(TEMPLATE, contextFor('Senior Software Engineer'));

    expect(html).toContain('<h1>Offer Letter</h1>');
    expect(html).toContain('Dear Sneha Patil, welcome as Senior Software Engineer.');
  });

  it('escapes special characters in benign values without breaking layout', () => {
    const html = renderTemplate(TEMPLATE, contextFor('R&D Lead'));

    expect(html).toContain('R&amp;D Lead');
    expect(html).not.toContain('R&D Lead');
  });

  it('sanitizeTemplateHtml strips dangerous tags but keeps layout tags', () => {
    const html = sanitizeTemplateHtml(
      '<div><script>evil()</script><p onclick="evil()">Hi</p><a href="https://example.com">link</a></div>',
    );

    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
    expect(html).toContain('<p>Hi</p>');
    expect(html).toContain('<a href="https://example.com">link</a>');
  });
});
