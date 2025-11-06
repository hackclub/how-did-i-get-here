# how-did-i-get-here server readme

i'm always accessible on slack or via email `hi@kognise.dev` if you need me.


## help! it's broken!

the main things you might need to know are:

### caddy

the caddy server is what the web domain points directly to, handles https, and reverse proxies to a local server.

the config is in `/etc/caddy/Caddyfile`. caddy can be restarted with `service caddy restart`.

if something is wrong with caddy, this is a good way to test it out with easier access to logs:

```sh
cd /etc/caddy
service caddy stop
caddy run
# then just ^C to kill it

# when you're done, start the normal service:
service caddy start
```

### local server

the actual server runs inside bun, which is a javascript runtime.

right now it's just running in a tmux session, wrapped in a really stupid program i wrote when i was 12 called cach. it should really be in a systemd service.

- to restart it, you can `tmux attach`, Ctrl-C to kill it, and then rerun the command.
- if the server got restarted, run `tmux` to make a new session, then `cd /root/how-did-i-get-here` and run `cach bun start`.

### admin page

there's an admin page at `https://how-did-i-get-here.net/admin?password=<ADMIN PASSWORD HERE>`. if you forget the password, you can find it in `/root/how-did-i-get-here/.env`.


## setup chronicle

this is a log of everything i did to set this server up, and how to do it again if needed in the future.

### ssh setup

write your ssh public key:

```sh
nano /root/.ssh/authorized_keys
```

disable password authentication for security:

```sh
nano /etc/ssh/sshd_config
# add the line: "PasswordAuthentication no"

service ssh restart
```

### prerequisites

install packages:

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | bash

apt update
apt install -y caddy unzip nodejs python3 python3-pip python3-virtualenv

curl -fsSL https://bun.sh/install | bash

curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# press enter when prompted
```

source the bashrc so you can use bun and rust:

```sh
source /root/.bashrc
```

install cach to restart the server on errors:

```sh
bun install --global cach
```

### configure peeringdb

get a [peeringdb api key](https://docs.peeringdb.com/howto/api_keys/). if moving from an existing setup, just take it from the old `/root/.peeringdb/config.yaml` file.

make a config directory:

```sh
mkdir /root/.peeringdb
```

write the following file to `/root/.peeringdb/config.yaml`:

```yaml
orm:
  backend: django_peeringdb
  database:
    engine: sqlite3
    host: ''
    name: /root/peeringdb-py/peeringdb.sqlite3
    password: ''
    port: 0
    user: ''
  migrate: true
  secret_key: ''
sync:
  api_key: <API KEY HERE>
  only: []
  password: ''
  strip_tz: 1
  timeout: 0
  url: https://www.peeringdb.com/api
  user: ''
```

create a virtual environment and install the peeringdb cli:

```sh
mkdir /root/peeringdb-py
cd /root/peeringdb-py

virtualenv --python=python3 pdbvenv
source pdbvenv/bin/activate
pip install peeringdb django-peeringdb "django>=3.2,<3.3"

deactivate
```

### create scripts

write the following scripts.

`/root/update-peeringdb.sh`:

```sh
#!/bin/bash
cd /root/peeringdb-py
source pdbvenv/bin/activate
time peeringdb sync
```

`/root/update-ktr.sh`:

```sh
#!/bin/bash
cd /root/ktr/ktr_agent/
git pull
cargo build --release
```

`/root/serve.sh`:

```sh
#!/bin/bash
cd /root/how-did-i-get-here
killall ktr_agent
killall node
git pull
bun install --frozen-lockfile
cach bun start
```

then make them executable:

```sh
chmod +x /root/update-peeringdb.sh /root/update-ktr.sh /root/serve.sh
```

### prepare repos

time for a bunch of slow steps that involve lots of waiting around!

clone the main repos:

```sh
cd /root/
git clone https://github.com/hackclub/how-did-i-get-here.git
git clone https://github.com/hackclub/ktr.git
```

sync peeringdb, this will take a very long time (between 15 minutes and an hour) the first time around:

```sh
/root/update-peeringdb.sh
```

build ktr:

```sh
/root/update-ktr.sh
```

### configure main server

write the following to `/root/how-did-i-get-here/.env`. make sure to insert the appropriate variables:

- `TRACEROUTE_INTERFACE_NAME`: the interface to run traceroutes over. this should be the public interface from the output of `ip addr`, it will probably be something like `eth0`.
- `SERVER_IP`: the public ipv4 address of this server. it should also show up under `inet` under the public interface in `ip addr`.
- `ADMIN_PASSWORD`: the password for the admin page. you will be able to access `https://how-did-i-get-here.net/admin?password=<PASSWORD HERE>` using this password.

```
TRACEROUTE_INTERFACE_NAME=
SERVER_IP=
ADMIN_PASSWORD=

KTR_AGENT_PATH=/root/ktr/target/release/ktr_agent
PEERINGDB_PATH=/root/peeringdb-py/peeringdb.sqlite3
PORT=8080
SERVER_HOST=how-did-i-get-here.net
```

### configure caddy

clear the dumb default caddyfile:

```sh
echo "" > /etc/caddy/Caddyfile
```

now write the following to `/etc/caddy/Caddyfile`:

```caddy
how-did-i-get-here.net {
	reverse_proxy :8080
}
```

🚧 **at this point, you should make sure dns is pointing to this server or tls certificate provisioning will likely fail.** 🚧

finally, restart caddy:

```sh
service caddy restart
```

within a minute or so, an tls certificate should be provisioned and the website should be able to work!
