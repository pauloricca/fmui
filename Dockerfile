FROM node:24-alpine AS development

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci
COPY bs-config.cjs ./
COPY app ./app
EXPOSE 5173
CMD ["npm", "run", "dev"]

FROM nginx:1.27-alpine AS production

COPY app /usr/share/nginx/html
