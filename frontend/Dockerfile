
FROM node:22-alpine AS build
WORKDIR /usr/src/app


COPY package.json package-lock.json .env ./
RUN npm ci


COPY . .

RUN npm run build


FROM nginx:stable-alpine


COPY --from=build /usr/src/app/build /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
