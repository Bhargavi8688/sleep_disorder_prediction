import pandas as pd
import sqlite3

# ===============================
# 1. Read Excel File
# ===============================
excel_file = r"C:\Users\Swarna\Downloads\archive\sleep_disorders.xlsx"
df = pd.read_excel(excel_file)

# ===============================
# 2. Connect to SQLite Database
# ===============================
conn = sqlite3.connect("sleep_disorders.db")
cursor = conn.cursor()

# ===============================
# 3. Create Table
# ===============================
create_table_query = """
CREATE TABLE IF NOT EXISTS sleep_disorders (
    person_id INTEGER,
    gender TEXT,
    age INTEGER,
    occupation TEXT,
    sleep_duration REAL,
    quality_of_sleep TEXT,
    physical_activity_level TEXT,
    stress_level TEXT,
    bmi_category TEXT,
    blood_pressure TEXT,
    heart_rate INTEGER,
    daily_steps INTEGER,
    sleep_disorder TEXT
)
"""
cursor.execute(create_table_query)

# ===============================
# 4. Load Excel Data into Table
# ===============================
df.to_sql(
    "sleep_disorders",
    conn,
    if_exists="replace",   # change to "append" if needed
    index=False
)

# ===============================
# 5. Verify Data
# ===============================
result = cursor.execute(
    "SELECT * FROM sleep_disorders LIMIT 5"
).fetchall()

print("Sample records from database:")
for row in result:
    print(row)

# ===============================
# 6. Close Connection
# ===============================
conn.close()
