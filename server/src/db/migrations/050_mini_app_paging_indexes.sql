CREATE INDEX memories_mini_app_page_idx ON memories (user_id,created_at DESC,id DESC) WHERE active=true;
CREATE INDEX documents_mini_app_page_idx ON documents (user_id,created_at DESC,id DESC) WHERE status<>'deleted';
CREATE INDEX devices_mini_app_page_idx ON devices (user_id,created_at DESC,id DESC) WHERE status<>'revoked';
CREATE INDEX life_commitments_mini_app_page_idx ON life_commitments (user_id,due_at ASC NULLS LAST,created_at DESC,id DESC) WHERE status='open';
CREATE INDEX messages_mini_app_page_idx ON messages (user_id,conversation_id,created_at DESC,id DESC) WHERE role IN ('user','assistant');
