import sqlite3

DATABASE_FILE = "shop.db"

def open_database():
  address = "file:" + DATABASE_FILE + "?mode=ro"
  connection = sqlite3.connect(address, uri=True)
  return connection