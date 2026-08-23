# HTTP active-organisation migration note

The REST boundaries for credits, AI request context, connected-system administration, management settings, sales automation, and sales targets previously resolved a first membership after local user authentication. They are now being moved to `requireLocalHttpContext()`, which verifies the signed active organisation and second-factor session in one reusable boundary.
