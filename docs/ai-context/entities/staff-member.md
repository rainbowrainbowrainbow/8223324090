# Entity: Staff Member

## Meaning

A Staff Member is an employee/personnel record used by HR, schedule, check-in, payroll, and staff-account linking.

## Fields / Properties

Source evidence: `routes/staff.js`, `services/hr.js`, staff migrations.

- id
- name/display name
- role/department
- schedule/shift fields
- face descriptor/check-in fields
- linked user account metadata

Status: exact field set varies across staff migrations and should be checked before schema-level answers.

## Related Entities

- Staff member may link to User Account.
- Staff member has shifts/check-ins.
- Staff member may participate in payroll.

## Where It Appears

- Staff Schedule page.
- HR page.
- Check-in page.
- Account Center staff binding.

## Assistant Interpretation

Do not confuse staff member records with login user accounts. If the user asks about login/password, use User Account; if they ask about schedule/role/personnel, use Staff Member.
