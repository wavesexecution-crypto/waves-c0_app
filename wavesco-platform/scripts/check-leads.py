import sqlite3
conn = sqlite3.connect(r'D:\wavesco-lead-engine\data\leads.db')
c = conn.cursor()
c.execute("""
    SELECT count(*) c FROM leads
    WHERE email IS NOT NULL AND TRIM(email) <> ''
      AND UPPER(COALESCE(email_status,'')) LIKE '%VERIFIED%'
      AND COALESCE(opted_out, 0) = 0
      AND date_contacted IS NULL
""")
print("emailReady:", c.fetchone()[0])
c.execute("""
    SELECT id, business, email, verification, email_status FROM leads WHERE email IS NOT NULL
""")
for r in c.fetchall():
    print(r)
conn.close()
