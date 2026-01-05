FROM node:22 AS build

WORKDIR /src/nav-app

# install dependencies (cache)
COPY ./nav-app/package.json ./
COPY ./nav-app/package-lock.json ./
RUN npm ci

# copy source and build
COPY ./nav-app/ ./
RUN npm run build -- --configuration production

# copy layers directory and in-app documentation
WORKDIR /src
COPY layers/ ./layers/
COPY *.md ./

FROM nginx:alpine AS runtime

# copy application bundles
COPY --from=build /src/nav-app/dist/browser/ /usr/share/nginx/html/
COPY --from=build /src/layers/ /usr/share/nginx/html/layers/
COPY --from=build /src/*.md /usr/share/nginx/html/

EXPOSE 80

# run nginx in foreground
CMD ["nginx", "-g", "daemon off;"]