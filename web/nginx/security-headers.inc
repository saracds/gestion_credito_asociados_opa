# Cabeceras de seguridad de la SPA. Se incluyen en cada location porque en
# Nginx un add_header dentro de un location anula los heredados del server.
#
# Content-Security-Policy: solo se ejecuta JavaScript propio y solo se habla
# con el mismo origen (la API va por /api). Es la defensa principal contra XSS,
# importante porque el token vive en memoria de la página.
#   style-src 'unsafe-inline': los componentes Radix posicionan diálogos con
#   atributos style; no permite ejecutar código.
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
