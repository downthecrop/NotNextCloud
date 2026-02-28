# NotNextCloud2 Pi 4 Bundle

## Included
- `install.sh`: installs Docker if needed, enables Docker on boot, installs this bundle, and starts the container
- `uninstall.sh`: stops and removes the container
- `docker-compose.yml`: runs the app with `restart: unless-stopped`
- `config.example.json`: production-leaning config template

## Quick Start
1. Copy this folder to your Pi 4.
2. Run:
   ```bash
   chmod +x install.sh uninstall.sh
   ./install.sh
   ```
3. Edit `/opt/notnextcloud2/config.json`:
   - Set real `auth.user` / `auth.pass`
   - Set `roots` to your media mount paths (host paths, like `/mnt/SSD`)
4. Apply changes:
   ```bash
   sudo docker compose -f /opt/notnextcloud2/docker-compose.yml up -d --build
   ```

## Notes
- Default web port is `4170`.
- Override install location:
  ```bash
  APP_DIR=/srv/notnextcloud2 ./install.sh
  ```
- To uninstall container only:
  ```bash
  ./uninstall.sh
  ```
