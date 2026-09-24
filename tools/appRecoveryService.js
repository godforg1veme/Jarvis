const { AppRecoveryRegistry } = require('./appRecoveryRegistry');
const { AppDiscoveryService } = require('./appDiscoveryService');
const { validateAndRank } = require('./appCandidateValidator');
const { matchCandidates } = require('./aiAppMatcher');
const { evaluateLaunchPolicy, createFingerprint } = require('./launchPolicy');
const launchApp = require('./launchApp');
const learnedAppStore = require('./learnedAppStore');
const { stripLaunchTrigger } = require('./appIdentity');
const { canonicalizeLaunchDescriptor } = require('./launchDescriptor');
const defaultAppResolver = require('./appResolver');

class AppRecoveryService {
  constructor(options = {}) {
    this.registry = options.registry || new AppRecoveryRegistry(options);
    this.discovery = options.discovery || new AppDiscoveryService(options);
    this.validateAndRank = options.validateAndRank || validateAndRank;
    this.matcher = options.matcher || matchCandidates;
    this.launcher = options.launcher || launchApp.launchDescriptor;
    this.store = options.store || learnedAppStore;
    this.policy = options.policy || evaluateLaunchPolicy;
    this.fingerprint = options.fingerprint || createFingerprint;
    this.appResolver = options.appResolver || defaultAppResolver;
    this.emit = options.emit || (() => {});
    this.validatorOptions = options.validatorOptions || {};
  }

  snapshot(attempt) {
    return this.registry.publicSnapshot(attempt.recoveryId);
  }

  publish(attempt) {
    const snapshot = this.snapshot(attempt);
    this.emit(snapshot);
    return snapshot;
  }

  findLearned(candidate) {
    const key = canonicalizeLaunchDescriptor(candidate.launch);
    return this.store.load({ quarantine: false }).apps.find(app => canonicalizeLaunchDescriptor(app.launch) === key) || null;
  }

  async start(query, options = {}) {
    const attempt = this.registry.create(query, options.inputChannel || 'text');
    const searchQuery = String(options.normalizedQuery || stripLaunchTrigger(query) || query).trim();
    this.publish(attempt);
    try {
      const local = this.appResolver.resolve(searchQuery);
      if (local?.ok && local.app) {
        const localCandidates = this.validateAndRank([local.app], searchQuery, this.validatorOptions);
        if (localCandidates.length === 1) {
          const candidate = localCandidates[0];
          this.registry.addCandidates(attempt.recoveryId, [candidate]);
          attempt.match = { mode: 'single', candidates: [candidate], aliases: [], aiUsed: false };
          const learned = this.findLearned(candidate);
          const policy = this.policy(candidate.launch, learned, this.validatorOptions);
          if (policy.decision === 'launch_allowed') {
            this.registry.transition(attempt.recoveryId, 'launching');
            this.publish(attempt);
            const launchResult = await this.launcher(candidate.launch, { ...this.validatorOptions, name: candidate.displayName });
            if (launchResult?.ok) {
              this.registry.transition(attempt.recoveryId, 'completed', {
                result: { ...launchResult, message: `Запустил ${candidate.displayName}.` },
              });
            } else {
              this.registry.transition(attempt.recoveryId, 'failed', {
                error: launchResult?.error || 'Не удалось запустить приложение.', result: launchResult,
              });
            }
            return this.publish(attempt);
          }
          if (policy.decision === 'confirmation_required') {
            this.registry.present(attempt.recoveryId, [candidate.candidateId], 'awaiting_confirmation');
            return this.publish(attempt);
          }
        }
      }

      this.registry.transition(attempt.recoveryId, 'quick_discovery');
      this.publish(attempt);
      const quick = await this.discovery.discoverQuick(searchQuery, {
        ...options,
        signal: attempt.abortController.signal,
      });
      if (attempt.abortController.signal.aborted) return this.snapshot(attempt);
      let candidates = this.validateAndRank(quick.candidates, searchQuery, this.validatorOptions);

      const hasPromisingQuickCandidate = candidates.some(candidate => candidate.localScore >= 0.60);
      if (!hasPromisingQuickCandidate && options.extended !== false) {
        this.registry.transition(attempt.recoveryId, 'extended_discovery');
        this.publish(attempt);
        const extended = await this.discovery.discoverExtended(searchQuery, {
          ...options,
          signal: attempt.abortController.signal,
          onProgress: progress => {
            if (attempt.abortController.signal.aborted) return;
            attempt.progress = progress;
            this.publish(attempt);
          },
        });
        if (attempt.abortController.signal.aborted) return this.snapshot(attempt);
        candidates = this.validateAndRank([...quick.candidates, ...extended.candidates], searchQuery, this.validatorOptions);
      }

      if (candidates.length === 0) {
        this.registry.transition(attempt.recoveryId, 'failed', { error: 'Приложение не найдено.' });
        return this.publish(attempt);
      }

      this.registry.addCandidates(attempt.recoveryId, candidates);
      this.registry.transition(attempt.recoveryId, 'ai_ranking');
      this.publish(attempt);
      const match = await this.matcher(searchQuery, candidates, { ...options, signal: attempt.abortController.signal });
      if (attempt.abortController.signal.aborted) return this.snapshot(attempt);
      attempt.match = match;
      if (match.mode === 'none' || match.candidates.length === 0) {
        this.registry.transition(attempt.recoveryId, 'failed', { error: 'Не удалось уверенно выбрать приложение.' });
        return this.publish(attempt);
      }
      const ids = match.candidates.map(candidate => candidate.candidateId);
      const state = match.mode === 'single' ? 'awaiting_confirmation' : 'awaiting_selection';
      this.registry.present(attempt.recoveryId, ids, state);
      return this.publish(attempt);
    } catch (error) {
      if (attempt.abortController.signal.aborted) return this.snapshot(attempt);
      this.registry.transition(attempt.recoveryId, 'failed', { error: error.message });
      return this.publish(attempt);
    }
  }

  select(recoveryId, candidateId) {
    const attempt = this.registry.select(recoveryId, candidateId);
    return this.publish(attempt);
  }

  cancel(recoveryId, reason) {
    const attempt = this.registry.cancel(recoveryId, reason);
    return attempt ? this.publish(attempt) : null;
  }

  details(recoveryId, candidateId) {
    const attempt = this.registry.get(recoveryId);
    if (!attempt.presentedIds.includes(candidateId)) throw new Error('candidate is not presented');
    const candidate = attempt.candidates.get(candidateId);
    return {
      candidateId,
      displayName: candidate.displayName,
      type: candidate.launch.type,
      publisher: candidate.publisher,
      location: candidate.generalizedLocation,
      target: candidate.launch.target,
    };
  }

  async confirm(recoveryId) {
    const candidate = this.registry.confirmedCandidate(recoveryId);
    const attempt = this.registry.get(recoveryId);
    const learned = this.findLearned(candidate);
    const policy = this.policy(candidate.launch, learned, this.validatorOptions);
    if (policy.decision === 'blocked') {
      this.registry.transition(recoveryId, 'failed', { error: policy.reason });
      return this.publish(attempt);
    }

    this.registry.transition(recoveryId, 'launching');
    this.publish(attempt);
    const launchResult = await this.launcher(candidate.launch, { ...this.validatorOptions, name: candidate.displayName });
    if (!launchResult || launchResult.ok === false) {
      this.registry.transition(recoveryId, 'failed', { error: launchResult?.error || 'Не удалось запустить приложение.', result: launchResult });
      return this.publish(attempt);
    }

    this.registry.transition(recoveryId, 'learning');
    this.publish(attempt);
    let learningWarning = '';
    let learning = null;
    try {
      const aliases = [
        stripLaunchTrigger(attempt.query),
        candidate.displayName,
        ...(attempt.match?.matchedCandidateId === candidate.candidateId ? attempt.match.aliases || [] : []),
      ];
      const fingerprint = ['script', 'command'].includes(candidate.launch.type)
        ? this.fingerprint(candidate.launch, this.validatorOptions)
        : null;
      const now = new Date().toISOString();
      const saved = this.store.upsert({
        displayName: candidate.displayName,
        aliases,
        launch: candidate.launch,
        provenance: {
          source: candidate.source,
          aiProvider: attempt.match?.aiUsed ? 'openrouter' : 'local',
          originalQuery: attempt.query,
          confirmedVia: attempt.inputChannel,
        },
        trust: { confirmedAt: now, lastSuccessfulLaunchAt: now },
        fingerprint,
      });
      learning = {
        savedAliases: saved.savedAliases || [],
        skippedAliases: saved.skippedAliases || [],
      };
    } catch (error) {
      learningWarning = 'Запустил, но не смог запомнить.';
    }

    const learnedText = learning?.savedAliases?.length
      ? ` Запомнил: ${learning.savedAliases.join(', ')}.`
      : '';
    const result = {
      ...launchResult,
      learning,
      warning: learningWarning,
      message: learningWarning || `Запустил ${candidate.displayName}.${learnedText}`,
    };
    this.registry.transition(recoveryId, 'completed', { result });
    return this.publish(attempt);
  }
}

module.exports = { AppRecoveryService };
