import sqlite3

connection = sqlite3.connect("shop.db")

connection.execute("DROP TABLE IF EXISTS users")

connection.execute("DROP TABLE IF EXISTS orders")

connection.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)")

connection.execute("CREATE TABLE orders (id INTEGER PRIMARY KEY, user_id INTEGER, amount INTEGER)")

people = [
    ("Asha", "asha@example.com"),
    ("Ben", "ben@example.com"),
    ("Chen", "chen@example.com"),
]

for person in people:
  connection.execute("INSERT INTO users (name, email) VALUES (?, ?)", person)

order_count = 100000

for number in range(order_count):
    # Spread the orders across users 1, 2 and 3
    user_id = number % 3 + 1
    # A made-up price between 1 and 500
    amount = number % 500 + 1
    # Add the order as one row
    connection.execute("INSERT INTO orders (user_id, amount) VALUES (?, ?)", (user_id, amount))


connection.commit()

connection.close()

print("Created shop.db with", len(people), "users")

print("Created shop.db with", len(people), "users and", order_count, "orders")