FROM node:20-alpine
WORKDIR /app
COPY . /app
WORKDIR /app/server
RUN npm install --no-audit --no-fund \
 && npx next build
ENV NODE_ENV=production
ENV PORT=8123
EXPOSE 8123
CMD ["npm","start"]
