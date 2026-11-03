# Endemion Ecosystem — Unified Authentication System

This directory contains documentation for the unified Endemion ecosystem with centralized authentication through **Endemion Auth** (auth.endemion.online).

## Current Status

**Phase: Initial Audit**

Two background agents are currently analyzing:
- Endemion Life (life.endemion.online) — Game platform with NestJS + Next.js + PostgreSQL
- Endemion (endemion.online) — Main manga platform with buildless architecture + SQLite

## Documentation Structure

Once audits complete, the following documents will be created:

### 1. ENDEMION_ECOSYSTEM_AUDIT.md
Complete technical audit of both platforms:
- Current architecture and technology stacks
- Existing authentication mechanisms
- Database schemas and user models
- Security analysis
- Integration challenges and opportunities

### 2. ENDEMION_ECOSYSTEM_ARCHITECTURE.md
Unified ecosystem design:
- Centralized Identity Provider (auth.endemion.online)
- OAuth 2.0 / OpenID Connect flow
- Single Sign-On (SSO) architecture
- Session management strategy
- Security model

### 3. ENDEMION_AUTH_SETUP.md
Identity Provider implementation guide:
- Technology selection and rationale
- Installation and configuration
- UI/UX design matching Endemion brand
- Client registration for both platforms
- Development and production setup

### 4. ENDEMION_ACCOUNT_MIGRATION.md
Migration strategy for existing users:
- Data preservation approach
- Conflict resolution (email/username)
- Game progress protection
- Rollback procedures
- Testing strategy

### 5. ENDEMION_DEPLOYMENT.md
Production deployment procedures:
- VPS configuration (185.175.156.196)
- Docker Compose integration
- Caddy reverse proxy setup
- DNS configuration
- SSL/TLS certificates
- Zero-downtime deployment

### 6. ENDEMION_SECURITY.md
Security implementation details:
- HTTPS enforcement
- Cookie security (HttpOnly, Secure, SameSite)
- CSRF protection
- Rate limiting and brute-force prevention
- Token lifecycle management
- Audit logging

## Current Infrastructure

### Production Environment
- **VPS**: 185.175.156.196 (1 CPU, 2GB RAM shared)
- **Main Site**: endemion.online
  - Location: `/opt/endemion`
  - Stack: Node.js + SQLite + Docker + Caddy
  - Repository: github.com/Yuta2Endo/Endemion
  
- **Game Platform**: life.endemion.online
  - Location: `/opt/endemion-life`
  - Stack: NestJS + Next.js + PostgreSQL + Redis + Docker + Nginx
  - Repository: github.com/Yuta2Endo/Endemion-Life (private)
  - Behind Caddy proxy from main site

### Planned Addition
- **Auth Service**: auth.endemion.online
  - Centralized OpenID Connect Provider
  - Unified user database
  - Single Sign-On coordinator

## Design Principles

1. **User Experience First**
   - One registration, one password
   - Seamless transition between platforms
   - Consistent visual identity
   - No repeated authentication

2. **Security by Design**
   - Industry-standard OAuth 2.0 / OIDC
   - Short-lived access tokens
   - Secure refresh token rotation
   - Comprehensive audit logging

3. **Data Integrity**
   - No user data loss during migration
   - Game progress preservation
   - Existing sessions honored during transition
   - Rollback capability at every step

4. **Production Constraints**
   - Shared VPS resources (1 CPU, 2GB RAM)
   - Zero-downtime deployment requirement
   - Existing Caddy/Docker infrastructure
   - Both platforms remain independently operational

## Next Steps

1. ✅ Launch parallel audits of both platforms
2. ⏳ Wait for audit completion
3. Create comprehensive audit document
4. Design unified architecture
5. Select and configure Identity Provider
6. Implement integration incrementally
7. Test thoroughly before production migration

---

**Status**: Awaiting audit results from background agents
**Last Updated**: 2026-11-03
