var BookingDrawerState = window.BookingDrawerState || {
    drawerMode: 'create_activity',
    drawerGenerationId: 0,
    clientMode: 'search',
    selectedProgramCategory: 'all',
    selectedActivityProgramIds: [],
    validationAttempted: false,
    roomBookingAnimationBridge: null,
    legacyNotesFallback: false,
    legacyGroupNameFallback: false,
    banquetGroupCandidates: [],
    banquetGroupFallbackCandidates: [],
    banquetGroupCandidatesLoading: false,
    banquetGroupCandidatesKey: '',
    selectedBanquetGroupId: '',
    manualBanquetGroupSelection: false,
    roomSelectionContextRequestToken: 0,
    roomSourceContext: null,
    roomSelectionBanquetContext: null,
    autoFilledCustomerFromRoom: null,
    autoFilledBanquetFromRoom: null,
    autoFilledBanquetGuestsFromRoom: null,
    entryPriceRules: [],
    entryPriceRulesLoaded: false,
    entryPriceRulesLoading: false,
    entryPriceRulesPromise: null,
    entryPriceRulesError: null
};

var BOOKING_DRAWER_MODES = window.BOOKING_DRAWER_MODES || Object.freeze({
    CREATE_ACTIVITY: 'create_activity',
    CREATE_KITCHEN: 'create_kitchen',
    EDIT_BOOKING: 'edit_booking',
    ACTIVITY_FIRST_KITCHEN_BRIDGE: 'activity_first_kitchen_bridge',
    KITCHEN_FIRST_ACTIVITY_BRIDGE: 'kitchen_first_activity_bridge',
    EXISTING_GROUP_MEMBER: 'existing_group_member',
    EXISTING_GROUP_ACTIVITY: 'existing_group_activity'
});
window.BookingDrawerState = BookingDrawerState;
window.BOOKING_DRAWER_MODES = BOOKING_DRAWER_MODES;
