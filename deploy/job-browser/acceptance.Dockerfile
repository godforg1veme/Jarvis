# Test-only image. Uses the repository lockfiles, never production credentials.
FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
RUN install -d -o pwuser -g pwuser /home/pwuser/acceptance/server /home/pwuser/acceptance/job-browser
WORKDIR /home/pwuser/acceptance/server
COPY --chown=pwuser:pwuser server/package.json server/package-lock.json ./
USER pwuser
RUN npm ci --omit=dev --no-audit --no-fund
WORKDIR /home/pwuser/acceptance/job-browser
COPY --chown=pwuser:pwuser job-browser/package.json job-browser/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=pwuser:pwuser job-browser/src ./src
COPY --chown=pwuser:pwuser job-browser/test ./test
WORKDIR /home/pwuser/acceptance/server
COPY --chown=pwuser:pwuser server/src ./src
COPY --chown=pwuser:pwuser server/test ./test
CMD ["node", "--test", "test/jobBrowserApplicationsAcceptance.cjs"]
