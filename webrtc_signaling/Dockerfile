ARG BUILD_FROM
FROM ${BUILD_FROM}

ENV LANG=C.UTF-8 \
    NODE_ENV=production

RUN apk add --no-cache nodejs npm

WORKDIR /opt/app

COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

COPY src/ ./src/
COPY ui/ ./ui/

COPY run.sh /run.sh
RUN chmod a+x /run.sh

EXPOSE 8765

CMD ["/run.sh"]
