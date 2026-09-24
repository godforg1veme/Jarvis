ALTER TABLE vpn_action_requests
  DROP CONSTRAINT IF EXISTS vpn_action_requests_action_check;

ALTER TABLE vpn_action_requests
  ADD CONSTRAINT vpn_action_requests_action_check CHECK (
    action IN (
      'issue', 'revoke', 'rotate', 'export', 'restart',
      'probe.install', 'probe.rotate', 'probe.recheck', 'probe.enable', 'probe.disable',
      'subscription.repair'
    )
  );
