# Check if mongodb is installed in the local environment for testing
command -v mongod >/dev/null 2>&1 || { echo >&2 "MongoDB needs to be installed locally in order for tests to run. Exiting."; exit 1; }

# test_db folder should exist
mkdir -p ./test/test_db

# mongodb is installed locally, start the daemon with the test_db folder
mongod --auth --dbpath ./test/test_db

# mongo --eval "db.createUser( ... )"