# Estágio de Build
FROM node:18-alpine AS build

WORKDIR /app

# Copia arquivos de dependência e instala
COPY package.json ./
RUN npm install

# Copia o código fonte e realiza o build de produção
COPY . .
RUN npm run build

# Estágio de Produção (Servidor Web Nginx)
FROM nginx:alpine

# Copia os arquivos compilados do React
COPY --from=build /app/dist /usr/share/nginx/html

# Copia a configuração do Nginx (inclui proxy reverso para a API)
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
