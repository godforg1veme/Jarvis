FROM mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
RUN install -d -o pwuser -g pwuser /home/pwuser/probe /home/pwuser/profile
RUN chmod 0700 /home/pwuser/profile
WORKDIR /home/pwuser/probe
COPY --chown=pwuser:pwuser package.json package-lock.json ./
USER pwuser
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=pwuser:pwuser src ./src
CMD ["node", "src/browserMain.js"]
