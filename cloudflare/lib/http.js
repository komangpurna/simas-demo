/**
 * Helper respons HTTP & CORS Worker SIMAS (whitelist origin, header keamanan, JSON/error envelope).
 */

export const ALLOWED_ORIGINS = ["https://simas-demo-5ead3.web.app","https://simas-demo-5ead3.firebaseapp.com","http://localhost:8080","http://127.0.0.1:8080","http://localhost:5000","http://127.0.0.1:5000","http://localhost:3000"];

export function getCorsHeaders(request) {
    const origin = request ? (request.headers.get("Origin") || "") : "";
    const isAllowed = !origin || ALLOWED_ORIGINS.some(o => o === origin) ||
        origin.startsWith("http://localhost:") ||
        origin.startsWith("http://127.0.0.1:");
    const allowedOrigin = isAllowed ? (origin || "*") : ALLOWED_ORIGINS[0];

    return {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Simas-Client, X-Migration-Key, X-Sync-Key, X-Api-Key, X-Student-Token",
        "Access-Control-Max-Age": "86400",
        "Vary": "Origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Referrer-Policy": "strict-origin-when-cross-origin"
    };
}

export function jsonResponse(data, status = 200, request = null) {
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        ...(request ? getCorsHeaders(request) : { "Access-Control-Allow-Origin": "*" })
    };
    return new Response(JSON.stringify(data), { status, headers });
}

export function errorResponse(message, status = 400, request = null) {
    return jsonResponse({ success: false, error: message }, status, request);
}
