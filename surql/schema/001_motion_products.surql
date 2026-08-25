DEFINE TABLE IF NOT EXISTS motion_artifact SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS digest ON TABLE motion_artifact TYPE string READONLY;
DEFINE FIELD IF NOT EXISTS size ON TABLE motion_artifact TYPE int ASSERT $value >= 0 READONLY;
DEFINE FIELD IF NOT EXISTS media_type ON TABLE motion_artifact TYPE string READONLY;
DEFINE FIELD IF NOT EXISTS content ON TABLE motion_artifact TYPE bytes READONLY;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE motion_artifact TYPE datetime DEFAULT ALWAYS time::now() READONLY;
DEFINE INDEX IF NOT EXISTS motion_artifact_digest ON TABLE motion_artifact FIELDS digest UNIQUE;

DEFINE TABLE IF NOT EXISTS motion_product SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS cache_key ON TABLE motion_product TYPE string READONLY;
DEFINE FIELD IF NOT EXISTS provider ON TABLE motion_product TYPE string READONLY;
DEFINE FIELD IF NOT EXISTS specification ON TABLE motion_product TYPE string READONLY;
DEFINE FIELD IF NOT EXISTS manifest ON TABLE motion_product TYPE record<motion_artifact> REFERENCE ON DELETE REJECT;
DEFINE FIELD IF NOT EXISTS created_at ON TABLE motion_product TYPE datetime DEFAULT ALWAYS time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON TABLE motion_product TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS motion_product_cache_key ON TABLE motion_product FIELDS cache_key UNIQUE;
