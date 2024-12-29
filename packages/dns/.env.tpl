# DNSimple
TF_VAR_dnsimple_account=op://PickMyFruit/DNSimple/Account
TF_VAR_dnsimple_token=op://PickMyFruit/DNSimple/Token
TF_VAR_dnsimple_zone=op://PickMyFruit/DNSimple/Zone

# Supabase: Postgres
PG_CONN_STR=op://PickMyFruit/Supabase/Postgres-${PG_CONN_TYPE:-Direct}/PG_CONN_STR
PGPASSWORD=op://PickMyFruit/Supabase/Postgres/PGPASSWORD
