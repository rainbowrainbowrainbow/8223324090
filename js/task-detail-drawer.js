/* Route all task entrypoints to the My Day dialog. */
(function attachTaskDetailDrawer(global) {
    'use strict';

    function taskUrl(taskId, options = {}) {
        return global.TaskLinks.taskUrl(taskId, options);
    }

    function open(taskId, options = {}) {
        if (!global.TaskLinks.taskId(taskId)) return Promise.resolve(false);
        global.location.href = taskUrl(taskId, options);
        return Promise.resolve(true);
    }

    global.openTaskDetail = open;
    global.TaskDetailDrawer = Object.freeze({ open, taskUrl });
}(window));
