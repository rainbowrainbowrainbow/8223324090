const INIT_DATABASE_FLOW = {
    serverFile: 'server.js',
    steps: ['initDatabase', 'runMigrations', 'initDatabase'],
    reason: 'Schema-fenced legacy two-phase startup keeps old environments bootable while SQL migrations remain the durable schema history.'
};

const STARTUP_SCHEMA_TABLES = [
    'automation_rules',
    'bookings',
    'certificates',
    'contractors',
    'customers',
    'finance_categories',
    'finance_transactions',
    'products',
    'schema_migrations',
    'settings',
    'staff',
    'staff_schedule',
    'tasks',
    'users'
];

const STARTUP_SCHEMA_COLUMNS = [
    'bookings.payment_method',
    'certificates.customer_id',
    'staff.telegram_username',
    'tasks.deadline',
    'tasks.dependency_ids',
    'tasks.source_id',
    'tasks.source_type'
];

const STARTUP_SCHEMA_INDEXES = [];
const STARTUP_SCHEMA_FUNCTIONS = [];
const STARTUP_SCHEMA_TRIGGERS = [];

const TASK22_BASELINE_STARTUP_SCHEMA = {
    tables: [
        'afisha',
        'afisha_templates',
        'automation_rules',
        'booking_counter',
        'bookings',
        'budget_plans',
        'certificate_counter',
        'certificates',
        'contractor_notifications',
        'contractors',
        'customers',
        'design_collections',
        'design_tags',
        'designs',
        'finance_categories',
        'finance_transactions',
        'history',
        'kleshnya_chat',
        'kleshnya_messages',
        'lines_by_date',
        'pending_animators',
        'point_transactions',
        'procurement_items',
        'procurement_lists',
        'products',
        'schema_migrations',
        'scheduled_deletions',
        'settings',
        'staff',
        'staff_schedule',
        'task_logs',
        'task_templates',
        'tasks',
        'telegram_known_chats',
        'telegram_known_threads',
        'user_action_log',
        'user_points',
        'user_streaks',
        'users'
    ],
    columns: [
        'afisha.description',
        'afisha.line_id',
        'afisha.original_time',
        'afisha.template_id',
        'afisha.type',
        'bookings.banquet_adults',
        'bookings.costume',
        'bookings.customer_id',
        'bookings.extra_data',
        'bookings.group_name',
        'bookings.kids_count',
        'bookings.payment_method',
        'bookings.skip_notification',
        'bookings.status',
        'bookings.telegram_message_id',
        'bookings.updated_at',
        'certificates.customer_id',
        'certificates.season',
        'certificates.value_uah',
        'customer_cards.business_context',
        'customers.business_context',
        'leads.business_context',
        'mailing_list.business_context',
        'products.business_context',
        'staff.rate_unit',
        'staff.telegram_username',
        'task_templates.business_context',
        'task_templates.category',
        'tasks.afisha_id',
        'tasks.archive_reason',
        'tasks.archived_at',
        'tasks.business_context',
        'tasks.category',
        'tasks.control_policy',
        'tasks.deadline',
        'tasks.dependency_ids',
        'tasks.duplicate_of_task_id',
        'tasks.escalation_level',
        'tasks.last_reminded_at',
        'tasks.owner',
        'tasks.source_id',
        'tasks.source_type',
        'tasks.task_type',
        'tasks.template_id',
        'tasks.time_window_end',
        'tasks.time_window_start',
        'tasks.type',
        'tasks.version',
        'users.telegram_chat_id',
        'users.telegram_username'
    ],
    indexes: [
        'idx_afisha_date',
        'idx_bookings_customer_id',
        'idx_bookings_date',
        'idx_bookings_date_status',
        'idx_bookings_line_date',
        'idx_bookings_linked_to',
        'idx_bookings_program_id',
        'idx_budget_plans_year_month',
        'idx_certificates_cert_code',
        'idx_certificates_customer_id',
        'idx_certificates_status',
        'idx_certificates_valid_until',
        'idx_contractor_notif_contractor',
        'idx_contractor_notif_status',
        'idx_contractors_active',
        'idx_contractors_invite',
        'idx_customers_child_name',
        'idx_customers_business_phone',
        'idx_customers_instagram',
        'idx_customers_name',
        'idx_customers_phone',
        'idx_design_tags_tag',
        'idx_designs_collection',
        'idx_designs_pinned',
        'idx_designs_publish_date',
        'idx_finance_categories_type',
        'idx_finance_transactions_booking',
        'idx_finance_transactions_category',
        'idx_finance_transactions_date',
        'idx_finance_transactions_type',
        'idx_history_action',
        'idx_history_created_at',
        'idx_leads_business_status_created',
        'idx_kleshnya_chat_username',
        'idx_kleshnya_messages_expires',
        'idx_kleshnya_messages_scope',
        'idx_lines_by_date_date',
        'idx_lines_by_date_line_date',
        'idx_point_transactions_username',
        'idx_procurement_items_list',
        'idx_procurement_items_stock',
        'idx_procurement_lists_department',
        'idx_procurement_lists_status',
        'idx_products_active',
        'idx_products_availability_status',
        'idx_products_business_active',
        'idx_products_business_code',
        'idx_products_business_domain_category',
        'idx_products_category',
        'idx_products_domain',
        'idx_products_kitchen_type',
        'idx_products_menu_section',
        'idx_scheduled_deletions_delete_at',
        'idx_staff_active',
        'idx_staff_department',
        'idx_staff_schedule_date',
        'idx_staff_schedule_staff',
        'idx_task_logs_created_at',
        'idx_task_logs_task_id',
        'idx_task_templates_business_active_created',
        'idx_tasks_afisha_id',
        'idx_tasks_business_completed_at',
        'idx_tasks_business_owner_active',
        'idx_tasks_business_source',
        'idx_tasks_business_status_date',
        'idx_tasks_category',
        'idx_tasks_completed_at',
        'idx_tasks_created_by',
        'idx_tasks_date',
        'idx_tasks_deadline',
        'idx_tasks_duplicate_of_task_id',
        'idx_tasks_escalation',
        'idx_tasks_owner',
        'idx_tasks_status',
        'idx_tasks_task_type',
        'idx_tasks_template_id',
        'idx_tasks_type',
        'idx_user_action_log_created_at',
        'idx_user_action_log_username',
        'idx_user_points_username',
        'idx_users_is_active',
        'idx_users_role'
    ],
    functions: ['update_updated_at_column'],
    triggers: ['trg_bookings_updated_at']
};

const DB_STARTUP_VERDICTS = [
    'REMOVE_DUPLICATE',
    'KEEP_PRE_MIGRATION_DEPENDENCY',
    'ADD_ADDITIVE_OWNERSHIP_MIGRATION',
    'BLOCKED_WITH_EVIDENCE'
];

function ownershipEntries(kind, objects, migrationOwner, verdict, evidence) {
    return objects.map(object => ({
        kind,
        object,
        startupLocation: 'db/index.js:initDatabase',
        migrationOwner,
        freshDbDependency: evidence.freshDbDependency,
        preMigrationReadDependency: evidence.preMigrationReadDependency,
        upgradeDependency: evidence.upgradeDependency,
        verdict
    }));
}

const KEEP_EVIDENCE = {
    bootstrapData: {
        freshDbDependency: 'first initDatabase pass must create the object before startup seed/bootstrap hooks run',
        preMigrationReadDependency: 'startup hook executes before runMigrations() in the schema-fenced startup flow',
        upgradeDependency: 'existing deployments preserve legacy two-phase startup behavior',
    },
    bookingsPayment: {
        freshDbDependency: '071_sales_funnel.sql creates idx_bookings_payment before migration 340 can run',
        preMigrationReadDependency: 'historical migration reads bookings.payment_method before the Task 22 owner migration',
        upgradeDependency: 'old upgrade path depends on initDatabase creating the column first',
    },
    certificateCustomer: {
        freshDbDependency: '018_backend_hardening.sql creates idx_certificates_customer_id before migration 340 can run',
        preMigrationReadDependency: 'historical migration reads certificates.customer_id before the Task 22 owner migration',
        upgradeDependency: 'old upgrade path depends on initDatabase creating the certificates/customers link first',
    },
    financeTransactions: {
        freshDbDependency: '018_backend_hardening.sql indexes finance_transactions before migration 340 can run',
        preMigrationReadDependency: 'historical finance/payroll migrations reference finance_transactions before the Task 22 owner migration',
        upgradeDependency: 'old upgrade path depends on initDatabase creating finance_transactions first',
    },
    taskLegacyColumns: {
        freshDbDependency: 'migrations 171, 185, 203, 237, 243, and 313 reference legacy task columns before migration 340 can run',
        preMigrationReadDependency: 'historical migrations read tasks.source_type/source_id/deadline/dependency_ids before the Task 22 owner migration',
        upgradeDependency: 'old upgrade path depends on initDatabase creating these compatibility columns first',
    }
};

const REMOVE_EVIDENCE = migrationOwner => ({
    freshDbDependency: 'covered by an earlier durable SQL migration before runtime route/service use',
    preMigrationReadDependency: 'no startup seed/bootstrap hook reads this object before runMigrations()',
    upgradeDependency: `durable owner ${migrationOwner} already preserves upgrade contract`
});

const ADDITIVE_EVIDENCE = {
    freshDbDependency: 'created by additive migration 340 after all prerequisite legacy migrations have run',
    preMigrationReadDependency: 'no startup seed/bootstrap hook or pre-340 historical migration requires this object',
    upgradeDependency: 'migration 340 is idempotent and preserves existing production objects without data changes'
};

const DB_STARTUP_SCHEMA_OWNERSHIP_MATRIX = [
    ...ownershipEntries('table', [
        'automation_rules',
        'products',
        'schema_migrations',
        'settings',
        'staff',
        'staff_schedule',
        'users'
    ], '001_initial_schema.sql / db/migrate.js', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.bootstrapData),
    ...ownershipEntries('table', [
        'contractors',
        'finance_categories'
    ], '009_budget_and_procurement.sql / 012_art_director.sql / startup seed hooks', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.bootstrapData),
    ...ownershipEntries('table', ['bookings'], '001_initial_schema.sql + 340_db_startup_schema_ownership.sql', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.bookingsPayment),
    ...ownershipEntries('table', ['certificates', 'customers'], '001_initial_schema.sql / 008_customers.sql + 340_db_startup_schema_ownership.sql', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.certificateCustomer),
    ...ownershipEntries('table', ['finance_transactions'], '340_db_startup_schema_ownership.sql', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.financeTransactions),
    ...ownershipEntries('table', ['tasks'], '001_initial_schema.sql + 340_db_startup_schema_ownership.sql', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.taskLegacyColumns),
    ...ownershipEntries('column', ['bookings.payment_method'], '340_db_startup_schema_ownership.sql', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.bookingsPayment),
    ...ownershipEntries('column', ['certificates.customer_id'], '340_db_startup_schema_ownership.sql', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.certificateCustomer),
    ...ownershipEntries('column', ['staff.telegram_username'], '001_initial_schema.sql', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.bootstrapData),
    ...ownershipEntries('column', [
        'tasks.deadline',
        'tasks.dependency_ids',
        'tasks.source_id',
        'tasks.source_type'
    ], '340_db_startup_schema_ownership.sql', 'KEEP_PRE_MIGRATION_DEPENDENCY', KEEP_EVIDENCE.taskLegacyColumns),

    ...ownershipEntries('table', [
        'contractor_notifications',
        'design_tags',
        'kleshnya_messages',
        'point_transactions',
        'task_logs',
        'user_action_log',
        'user_points',
        'user_streaks'
    ], '340_db_startup_schema_ownership.sql', 'ADD_ADDITIVE_OWNERSHIP_MIGRATION', ADDITIVE_EVIDENCE),
    ...ownershipEntries('column', [
        'bookings.skip_notification',
        'certificates.value_uah',
        'tasks.control_policy',
        'tasks.escalation_level',
        'tasks.last_reminded_at',
        'tasks.owner',
        'tasks.task_type',
        'tasks.time_window_end',
        'tasks.time_window_start',
        'users.telegram_chat_id',
        'users.telegram_username'
    ], '340_db_startup_schema_ownership.sql', 'ADD_ADDITIVE_OWNERSHIP_MIGRATION', ADDITIVE_EVIDENCE),
    ...ownershipEntries('index', [
        'idx_contractor_notif_contractor',
        'idx_contractor_notif_status',
        'idx_contractors_active',
        'idx_contractors_invite',
        'idx_customers_child_name',
        'idx_design_tags_tag',
        'idx_designs_collection',
        'idx_designs_pinned',
        'idx_designs_publish_date',
        'idx_finance_categories_type',
        'idx_finance_transactions_type',
        'idx_kleshnya_messages_expires',
        'idx_kleshnya_messages_scope',
        'idx_point_transactions_username',
        'idx_task_logs_created_at',
        'idx_task_logs_task_id',
        'idx_tasks_deadline',
        'idx_tasks_escalation',
        'idx_tasks_owner',
        'idx_tasks_task_type',
        'idx_user_action_log_created_at',
        'idx_user_action_log_username',
        'idx_user_points_username'
    ], '340_db_startup_schema_ownership.sql', 'ADD_ADDITIVE_OWNERSHIP_MIGRATION', ADDITIVE_EVIDENCE),

    ...ownershipEntries('table', [
        'afisha',
        'afisha_templates',
        'booking_counter',
        'certificate_counter',
        'history',
        'lines_by_date',
        'pending_animators',
        'scheduled_deletions',
        'task_templates',
        'telegram_known_chats',
        'telegram_known_threads'
    ], '001_initial_schema.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('001_initial_schema.sql')),
    ...ownershipEntries('table', [
        'budget_plans',
        'procurement_items',
        'procurement_lists'
    ], '009_budget_and_procurement.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('009_budget_and_procurement.sql')),
    ...ownershipEntries('table', [
        'design_collections',
        'designs'
    ], '012_art_director.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('012_art_director.sql')),
    ...ownershipEntries('table', ['kleshnya_chat'], '005_kleshnya_chat_v2.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('005_kleshnya_chat_v2.sql')),
    ...ownershipEntries('column', [
        'afisha.description',
        'afisha.line_id',
        'afisha.original_time',
        'afisha.template_id',
        'afisha.type',
        'bookings.costume',
        'bookings.extra_data',
        'bookings.group_name',
        'bookings.kids_count',
        'bookings.status',
        'bookings.telegram_message_id',
        'bookings.updated_at',
        'certificates.season',
        'task_templates.category',
        'tasks.afisha_id',
        'tasks.category',
        'tasks.template_id',
        'tasks.type'
    ], '001_initial_schema.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('001_initial_schema.sql')),
    ...ownershipEntries('column', ['bookings.customer_id'], '008_customers.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('008_customers.sql')),
    ...ownershipEntries('column', [
        'customer_cards.business_context',
        'customers.business_context',
        'leads.business_context',
        'mailing_list.business_context'
    ], '207_crm_business_context_scope.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('207_crm_business_context_scope.sql')),
    ...ownershipEntries('column', ['products.business_context'], '209_products_business_context_scope.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('209_products_business_context_scope.sql')),
    ...ownershipEntries('column', ['staff.rate_unit'], '258_staff_rate_unit.sql / 259_staff_rate_unit_default.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('258_staff_rate_unit.sql / 259_staff_rate_unit_default.sql')),
    ...ownershipEntries('column', [
        'task_templates.business_context',
        'tasks.business_context'
    ], '237_tasks_business_context_scope.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('237_tasks_business_context_scope.sql')),
    ...ownershipEntries('column', [
        'tasks.archive_reason',
        'tasks.archived_at'
    ], '142_task_cleanup_lifecycle.sql / 185_tasks_truth_completed_board.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('142_task_cleanup_lifecycle.sql / 185_tasks_truth_completed_board.sql')),
    ...ownershipEntries('column', ['tasks.duplicate_of_task_id'], '185_tasks_truth_completed_board.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('185_tasks_truth_completed_board.sql')),
    ...ownershipEntries('column', ['tasks.version'], '004_task_version_column.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('004_task_version_column.sql')),
    ...ownershipEntries('column', ['bookings.banquet_adults'], '264_banquet_booking_flag.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('264_banquet_booking_flag.sql')),
    ...ownershipEntries('index', [
        'idx_afisha_date',
        'idx_bookings_date',
        'idx_bookings_date_status',
        'idx_bookings_line_date',
        'idx_bookings_linked_to',
        'idx_bookings_program_id',
        'idx_certificates_cert_code',
        'idx_certificates_status',
        'idx_certificates_valid_until',
        'idx_history_created_at',
        'idx_lines_by_date_date',
        'idx_products_active',
        'idx_products_category',
        'idx_scheduled_deletions_delete_at',
        'idx_staff_active',
        'idx_staff_department',
        'idx_staff_schedule_date',
        'idx_staff_schedule_staff',
        'idx_tasks_afisha_id',
        'idx_tasks_category',
        'idx_tasks_date',
        'idx_tasks_status',
        'idx_tasks_template_id',
        'idx_tasks_type',
        'idx_users_is_active',
        'idx_users_role'
    ], '001_initial_schema.sql / 019_user_auth_indexes.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('001_initial_schema.sql / 019_user_auth_indexes.sql')),
    ...ownershipEntries('index', [
        'idx_bookings_customer_id',
        'idx_customers_instagram',
        'idx_customers_name',
        'idx_customers_phone'
    ], '008_customers.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('008_customers.sql')),
    ...ownershipEntries('index', [
        'idx_budget_plans_year_month',
        'idx_procurement_items_list',
        'idx_procurement_items_stock',
        'idx_procurement_lists_department',
        'idx_procurement_lists_status'
    ], '009_budget_and_procurement.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('009_budget_and_procurement.sql')),
    ...ownershipEntries('index', [
        'idx_history_action',
    ], '018_backend_hardening.sql / 245_backend_booking_timeline_hardening.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('018_backend_hardening.sql / 245_backend_booking_timeline_hardening.sql')),
    ...ownershipEntries('index', [
        'idx_finance_transactions_booking',
        'idx_finance_transactions_category',
        'idx_finance_transactions_date'
    ], '018_backend_hardening.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('018_backend_hardening.sql')),
    ...ownershipEntries('index', ['idx_certificates_customer_id'], '018_backend_hardening.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('018_backend_hardening.sql')),
    ...ownershipEntries('index', [
        'idx_customers_business_phone',
        'idx_leads_business_status_created'
    ], '207_crm_business_context_scope.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('207_crm_business_context_scope.sql')),
    ...ownershipEntries('index', [
        'idx_products_availability_status',
        'idx_products_business_active',
        'idx_products_business_code',
        'idx_products_business_domain_category',
        'idx_products_domain',
        'idx_products_kitchen_type',
        'idx_products_menu_section'
    ], '199_products_kitchen_fields.sql / 200_products_menu_structure_fields.sql / 209_products_business_context_scope.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('199_products_kitchen_fields.sql / 200_products_menu_structure_fields.sql / 209_products_business_context_scope.sql')),
    ...ownershipEntries('index', ['idx_kleshnya_chat_username'], '005_kleshnya_chat_v2.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('005_kleshnya_chat_v2.sql')),
    ...ownershipEntries('index', ['idx_lines_by_date_line_date'], '020_indexes_perf.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('020_indexes_perf.sql')),
    ...ownershipEntries('index', [
        'idx_task_templates_business_active_created',
        'idx_tasks_business_completed_at',
        'idx_tasks_business_owner_active',
        'idx_tasks_business_source',
        'idx_tasks_business_status_date'
    ], '237_tasks_business_context_scope.sql / 245_backend_booking_timeline_hardening.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('237_tasks_business_context_scope.sql / 245_backend_booking_timeline_hardening.sql')),
    ...ownershipEntries('index', ['idx_tasks_completed_at'], '185_tasks_truth_completed_board.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('185_tasks_truth_completed_board.sql')),
    ...ownershipEntries('index', ['idx_tasks_created_by'], '020_indexes_perf.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('020_indexes_perf.sql')),
    ...ownershipEntries('index', ['idx_tasks_duplicate_of_task_id'], '185_tasks_truth_completed_board.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('185_tasks_truth_completed_board.sql')),
    ...ownershipEntries('function', ['update_updated_at_column'], '002_add_updated_at.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('002_add_updated_at.sql')),
    ...ownershipEntries('trigger', ['trg_bookings_updated_at'], '002_add_updated_at.sql', 'REMOVE_DUPLICATE', REMOVE_EVIDENCE('002_add_updated_at.sql'))
];

const STARTUP_DATA_BOOTSTRAPS = [
    { name: 'firstUserBootstrap', sourceFile: 'db/index.js', marker: 'ensureInitialLoginUser()', owner: 'auth', mode: 'env-gated' },
    { name: 'legacyUserResetMarker', sourceFile: 'db/index.js', marker: '007_upsert_users_v12_5', owner: 'auth', mode: 'mark-only' },
    { name: 'legacyAnnaArtemMarker', sourceFile: 'db/index.js', marker: '008_add_anna_artem', owner: 'auth', mode: 'mark-only' },
    { name: 'productsSeed', sourceFile: 'db/index.js', marker: 'seedProducts()', owner: 'products', mode: 'seed-if-empty' },
    { name: 'staffAndScheduleSeed', sourceFile: 'db/index.js', marker: 'seedStaff()', owner: 'staff', mode: 'seed-if-empty' },
    { name: 'automationRulesSeed', sourceFile: 'db/index.js', marker: 'Automation rules seeded', owner: 'automation', mode: 'seed-if-empty' },
    { name: 'contractorZhenyaSeed', sourceFile: 'db/index.js', marker: '008_seed_contractor_zhenya', owner: 'contractors', mode: 'legacy-seed-marker' },
    { name: 'openclawUserBootstrap', sourceFile: 'db/index.js', marker: '009_seed_user_openclaw', owner: 'openclaw', mode: 'env-gated-marker' },
    { name: 'financeCategoriesSeed', sourceFile: 'db/index.js', marker: 'Finance categories seeded', owner: 'finance', mode: 'seed-if-empty' },
    { name: 'greetingCacheStartupDelete', sourceFile: 'server.js', marker: "DELETE FROM kleshnya_messages WHERE scope = 'daily_greeting'", owner: 'kleshnya', mode: 'startup-data-delete' }
];

const DB_STARTUP_SURFACE_DOC = 'docs/DB_STARTUP_SURFACE.md';
const STARTUP_DATA_BOOTSTRAP_MODES = [
    'env-gated',
    'mark-only',
    'seed-if-empty',
    'legacy-seed-marker',
    'env-gated-marker',
    'startup-data-delete'
];

module.exports = {
    INIT_DATABASE_FLOW,
    STARTUP_SCHEMA_TABLES,
    STARTUP_SCHEMA_COLUMNS,
    STARTUP_SCHEMA_INDEXES,
    STARTUP_SCHEMA_FUNCTIONS,
    STARTUP_SCHEMA_TRIGGERS,
    TASK22_BASELINE_STARTUP_SCHEMA,
    DB_STARTUP_SCHEMA_OWNERSHIP_MATRIX,
    DB_STARTUP_VERDICTS,
    STARTUP_DATA_BOOTSTRAPS,
    STARTUP_DATA_BOOTSTRAP_MODES,
    DB_STARTUP_SURFACE_DOC
};
