const { parseVpnHealth } = require('../../vpn/vpnHealthSchema');

const SUMMARY_BY_CODE = Object.freeze({
  VPN_SNAPSHOT_INVALID: 'Некорректный снимок состояния VPN',
  HOST_UNAVAILABLE: 'Хост VPN недоступен или перегружен',
  HOST_DNS_FAILURE: 'DNS на хосте VPN не отвечает',
  HOST_OUTBOUND_FAILURE: 'Исходящий HTTPS с хоста VPN недоступен',
  XRAY_CONFIG_FAILURE: 'Конфигурация Xray не прошла проверку',
  XRAY_SERVICE_FAILURE: 'Служба Xray недоступна',
  XRAY_LISTENER_FAILURE: 'Xray не слушает обязательные TCP-порты',
  HYSTERIA2_CONFIG_FAILURE: 'Конфигурация Hysteria2 не прошла проверку',
  HYSTERIA2_SERVICE_FAILURE: 'Служба Hysteria2 недоступна',
  HYSTERIA2_LISTENER_FAILURE: 'Hysteria2 не слушает UDP-порт',
  HYSTERIA2_AUTH_ENDPOINT_FAILURE: 'Локальная авторизация Hysteria2 недоступна',
  HYSTERIA2_AUTH_CREDENTIAL_FAILURE: 'Проверка авторизации клиента Hysteria2 не прошла',
  VPN_MULTI_STACK_FAILURE: 'Одновременно недоступны Xray и Hysteria2',
  UNKNOWN_VPN_FAILURE: 'Состояние VPN требует дополнительной диагностики',
});

const SERVICE_KEY_BY_SCOPE = Object.freeze({ host: 'vpn-host', xray: 'xray', hysteria2: 'hysteria2', multi: 'vpn-multi' });

class VpnIncidentAdapter {
  constructor({ repository, incidentEngine, hostId, requiredObservations = 3 }) {
    this.repository = repository;
    this.incidentEngine = incidentEngine;
    this.hostId = hostId;
    this.requiredObservations = requiredObservations;
    this.pendingKind = null;
    this.pendingCount = 0;
  }

  async observe(value) {
    const health = parseVpnHealth(value);
    const { diagnosis } = health;
    if (diagnosis.state !== 'incident') {
      this.pendingKind = null;
      this.pendingCount = 0;
      await this.repository.resolveClassifiedVpnIncidents({ hostId: this.hostId, exceptFailureKind: null });
      return null;
    }

    const primary = diagnosis.primary;
    if (this.pendingKind !== primary.failureKind) {
      this.pendingKind = primary.failureKind;
      this.pendingCount = 1;
    } else {
      this.pendingCount += 1;
    }
    if (this.pendingCount < this.requiredObservations) return null;

    const serviceKey = SERVICE_KEY_BY_SCOPE[primary.scope];
    const service = ['xray', 'hysteria2'].includes(primary.scope)
      ? await this.repository.serviceByKey(this.hostId, primary.scope)
      : null;
    const technicalDetail = JSON.stringify(diagnosis);
    if (technicalDetail.length > 4000) throw new Error('VPN_DIAGNOSIS_TOO_LARGE');
    const incident = await this.incidentEngine.observeClassified({
      serviceId: service && service.id,
      serviceKey,
      failureKind: primary.failureKind,
      severity: primary.severity,
      summary: SUMMARY_BY_CODE[primary.code],
      technicalDetail,
    });
    await this.repository.resolveClassifiedVpnIncidents({ hostId: this.hostId, exceptFailureKind: primary.failureKind });
    return incident;
  }

  async observeUnavailable() {
    const failureKind = 'vpn.health_unavailable';
    if (this.pendingKind !== failureKind) {
      this.pendingKind = failureKind;
      this.pendingCount = 1;
    } else {
      this.pendingCount += 1;
    }
    if (this.pendingCount < this.requiredObservations) return null;
    const incident = await this.incidentEngine.observeClassified({
      serviceId: null,
      serviceKey: 'vpn-host',
      failureKind,
      severity: 'error',
      summary: 'Диагностика VPN на Host Agent недоступна',
      technicalDetail: '{"version":1,"state":"unavailable","source":"vpn.health.snapshot"}',
    });
    await this.repository.resolveClassifiedVpnIncidents({ hostId: this.hostId, exceptFailureKind: failureKind });
    return incident;
  }
}

module.exports = { SUMMARY_BY_CODE, VpnIncidentAdapter };
