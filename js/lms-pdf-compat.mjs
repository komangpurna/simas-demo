// PDF.js needs this Promise API in both the page and its worker on older browsers.
export function ensurePdfPromiseSupport() {
    if (typeof Promise.withResolvers === 'function') return;
    Object.defineProperty(Promise, 'withResolvers', { configurable: true, writable: true, value: function () {
        let resolve, reject;
        const promise = new this((accept, decline) => { resolve = accept; reject = decline; });
        return { promise, resolve, reject };
    } });
}
