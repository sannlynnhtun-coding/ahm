window.ahmSetup = {
    async copyScript() {
        const response = await fetch('/setup/Ahm-Code.gs.txt');
        if (!response.ok) throw new Error('Apps Script code is unavailable.');
        await navigator.clipboard.writeText(await response.text());
    }
};

window.ahmUi = {
    focusById(id) {
        document.getElementById(id)?.focus();
    }
};
