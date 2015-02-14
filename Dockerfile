from ubuntu:14.04

RUN apt-get install -y curl

# Add PPA for latest nodejs versions. Do not need to run apt-get update after this
# as the script already does it.
RUN curl -sL https://deb.nodesource.com/setup | sudo bash -

RUN apt-get install -y nodejs python build-essential

COPY . /testdroid-proxy

WORKDIR /testdroid-proxy
RUN npm install --unsafe-perm

EXPOSE 80

ENTRYPOINT ["node", "build/bin/server.js"]
