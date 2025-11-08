#!/bin/sh

# Upload to server
scp -r _site/* bruegge@...

# make sure to fix the permissions on the server
# chmod -R 750 *



