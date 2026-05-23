# Page: Training

## Route / Location

- Route: `/training`
- Static file: `training.html`
- Page controller: `js/training-page.js`
- Backend route: `routes/training.js`
- Related navigation item: Team group -> `Навчання`

## Purpose

Training is the learning/knowledge base workspace for staff courses, homework, materials, and training progress.

## Primary Entities

- Course
- Lesson/material
- Homework
- Staff trainee
- Training progress

## Visible UI

- Training lists and content panels.
- Homework/course/progress controls.

## Available User Actions

- View courses/materials.
- Manage training content if role allows.
- Submit/review homework where supported.

## Data Sources

- `routes/training.js`
- `services/training.js`
- `db/migrations/054_training_knowledge_base.sql`
- `db/migrations/062_training_homework.sql`
- `db/migrations/064_training_courses.sql`

## Related Files

- `training.html`
- `js/training-page.js`
- `routes/training.js`

## Assistant Context

On Training, interpret questions as learning content, staff progress, or homework unless the user explicitly references HR schedule or account access.
