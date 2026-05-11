#!/usr/bin/with-contenv sh
set -e

cd /opt/app
exec node src/index.js
