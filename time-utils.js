(function registerACEdunityTime(root) {
    const TIME_24_PATTERN = /^(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
    const TIME_12_PATTERN = /^(0?[1-9]|1[0-2])(?::([0-5]\d))?$/;

    function normalize24HourTime(value) {
        const match = String(value || '').trim().match(TIME_24_PATTERN);
        if (!match) return '';
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (hours > 23 || minutes > 59) return '';
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }

    function convert24HourTo12(value) {
        const normalized = normalize24HourTime(value);
        if (!normalized) return { clock: '', period: 'AM' };
        const [hoursText, minutes] = normalized.split(':');
        const hours = Number(hoursText);
        return {
            clock: `${hours % 12 || 12}:${minutes}`,
            period: hours >= 12 ? 'PM' : 'AM'
        };
    }

    function convert12HourTo24(clockValue, periodValue) {
        const match = String(clockValue || '').trim().match(TIME_12_PATTERN);
        const period = String(periodValue || '').trim().toUpperCase();
        if (!match || !['AM', 'PM'].includes(period)) return '';
        let hours = Number(match[1]);
        const minutes = match[2] || '00';
        if (period === 'AM' && hours === 12) hours = 0;
        if (period === 'PM' && hours !== 12) hours += 12;
        return `${String(hours).padStart(2, '0')}:${minutes}`;
    }

    function formatTime24ForDisplay(value, emptyLabel = '') {
        const normalized = normalize24HourTime(value);
        if (!normalized) return emptyLabel || String(value || '').trim();
        const converted = convert24HourTo12(normalized);
        return `${converted.clock} ${converted.period}`;
    }

    root.ACEdunityTime = Object.freeze({
        normalize24HourTime,
        convert24HourTo12,
        convert12HourTo24,
        formatTime24ForDisplay
    });
})(typeof globalThis !== 'undefined' ? globalThis : window);
