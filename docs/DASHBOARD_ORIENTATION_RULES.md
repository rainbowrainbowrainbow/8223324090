# Dashboard orientation rules

The Dashboard "day orientation" and "my focus" surfaces must use the same
truthful candidate set. The largest counter is never enough to become the
primary recommendation.

Priority order:

1. A concrete action with a near deadline or a real risk for the nearest event.
2. An urgent client commitment, including stale lead/contact follow-up.
3. A task explicitly selected by the user through the existing focus rules.
4. Other current visible work.
5. Review of accumulated overdue work.

Every recommendation must include a reason, the source that produced it, and a
canonical navigation target. Missing or partial source data must block calm-day
wording such as "everything is ready" or "there are no tasks".

Metric labels must describe the source precisely:

- booking price sums are "Confirmed booking value", not payments, revenue, or
  profit;
- `status = in_progress` is "Tasks in progress";
- stale contacts are "No contact for more than 48 hours" with the visible
  business scope and period.
