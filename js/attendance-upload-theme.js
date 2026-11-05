(function(){
    'use strict';
    try {
        const key=document.currentScript.dataset.themePreference;
        document.documentElement.setAttribute('data-theme',localStorage.getItem(key)!=='false'?'dark':'light');
    } catch {document.documentElement.setAttribute('data-theme','light');}
})();
