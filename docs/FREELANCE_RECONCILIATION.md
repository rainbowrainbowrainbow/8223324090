# Freelance schedule, attendance, and payroll

| Surface | Owner and stored data | Existing access and dependencies |
| --- | --- | --- |
| Employee directory and historical slots | `staff.id` identifies a person or a legacy directory slot. `staff.is_freelance` is the legacy slot flag. | The active schedule roster excludes legacy slots. The two create actions select an eligible existing staff card using the existing schedule capability. |
| Schedule and HR plan | The day editor saves through `PUT /api/staff/schedule` and the canonical plan writer. `staff_schedule` is the scheduling projection. `hr_shifts` owns the employee/date plan and `hr_shift_segments` owns work mode, offsets and segment identity. | The freelance department row and employee cells open the same day editor. The row reads persisted segments and creates no roster rows or plan records independently. |
| Timekeeping and HR review | Clock-in/out and `PUT /api/hr/records/:id/correct` write `hr_time_records`, its compensation snapshot and audit records. Actual breaks are stored in `break_intervals`. | Existing HR manage and Park ownership rules apply. An automatically closed day, an open break or an attendance review flag requires HR review before freelance confirmation. |
| Terms and confirmation | Rate history and agreed terms are linked to segment IDs. The payroll confirmation API freezes the observed time and accepted allocation by attendance and segment ID. | Existing `manage_payroll_rules` and `manage_payroll_accrual` actions remain separate. Readers use existing `view_payroll`. |
| Salary, settlement and movements | Regular payroll consumes confirmed regular minutes on mixed days. Freelance settlement uses the confirmed freelance blocks. Payments and reversals write linked finance transactions. | Existing payroll actions, idempotency keys, payable balance checks and immutable finance history apply. Existing unsupported substitution rules apply to freelance shifts. |
| Monthly Excel | The freelance worksheet reads the same projection as the selected-day Finance UI. Confirmed payable minutes come from the confirmed block. | Existing payroll XLSX business scope and export authorization apply. |

The plan may be edited before clock-in. A plan used by an active or finished attendance record stays attached to that fact. HR can correct clocks and finish a factual break before payroll confirmation. After confirmation the HR correction endpoint returns a specific locked response. Paid blocks retain the same protection after payment and reversal. A correction that would replace the confirmed hours requires a separately reviewed accounting adjustment workflow with an audit trail.

For new freelance confirmations, the observed intervals use recorded clock times and explicit day offsets. Closed factual break windows replace the estimated segment break for that day. Without factual windows the segment break policy applies. The allocator excludes interior gaps. Each segment's observed minutes stay with that segment. Only additional worked minutes outside the scheduled envelope can be manually allocated, with a reason. A confirmed snapshot retains the intervals, breaks and reason as evidence. Legacy confirmations retain their original confirmed minutes.

Staff offboarding preserves both schedule projections for dates with attendance, agreed freelance terms, or a freelance confirmation. Future plans with no such history remain eligible for cleanup.

## Read-only audit

Run `scripts/audit-freelance-duplicates.sql` with psql using an authorized read-only connection. The script returns aggregate counts and bounds the overlap scan to the last 90 days and the next 30. Work blocks count as a conflict when they overlap for the same person and at least one is freelance. Equal times for different people, adjacent blocks and distinct partial payments are valid. Shared legacy identity keys are review candidates. Finance linkage and confirmation uniqueness are checked independently.

## Release scope

The functional change introduces no schema migration. Review the fresh live-to-candidate diff before release. The production runbook classifies `routes/payroll.js` as protected. Obtain a matching scoped release authorization for the new candidate and exact base. Any production repair to historical attendance, confirmed hours, paid records or customer data requires its own approved scope.
