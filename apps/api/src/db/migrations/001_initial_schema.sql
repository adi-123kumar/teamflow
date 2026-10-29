
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(320) NOT NULL,
    password_hash TEXT NOT NULL,
    full_name VARCHAR(120) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT users_email_unique UNIQUE (email)
);

CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(120) NOT NULL,
    slug VARCHAR(80) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT organizations_slug_unique UNIQUE (slug)
);

CREATE TABLE memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    user_id UUID NOT NULL,
    role VARCHAR(30) NOT NULL DEFAULT 'member',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT memberships_organization_fk
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE CASCADE,

    CONSTRAINT memberships_user_fk
        FOREIGN KEY (user_id)
        REFERENCES users(id) ON DELETE CASCADE,

    CONSTRAINT memberships_role_check
        CHECK (role IN ('owner', 'admin', 'project_manager', 'member')),

    CONSTRAINT memberships_org_user_unique
        UNIQUE (organization_id, user_id),

    CONSTRAINT memberships_id_org_unique
        UNIQUE (id, organization_id)
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    name VARCHAR(160) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_by_membership_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT projects_organization_fk
        FOREIGN KEY (organization_id)
        REFERENCES organizations(id) ON DELETE CASCADE,

    CONSTRAINT projects_creator_membership_fk
        FOREIGN KEY (created_by_membership_id, organization_id)
        REFERENCES memberships(id, organization_id),

    CONSTRAINT projects_status_check
        CHECK (status IN ('active', 'completed', 'archived')),

    CONSTRAINT projects_id_org_unique
        UNIQUE (id, organization_id)
);

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    project_id UUID NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'todo',
    priority VARCHAR(20) NOT NULL DEFAULT 'medium',
    assignee_membership_id UUID,
    due_date DATE,
    created_by_membership_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tasks_project_fk
        FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id) ON DELETE CASCADE,

    CONSTRAINT tasks_assignee_membership_fk
        FOREIGN KEY (assignee_membership_id, organization_id)
        REFERENCES memberships(id, organization_id),

    CONSTRAINT tasks_creator_membership_fk
        FOREIGN KEY (created_by_membership_id, organization_id)
        REFERENCES memberships(id, organization_id),

    CONSTRAINT tasks_status_check
        CHECK (status IN ('todo', 'in_progress', 'in_review', 'done')),

    CONSTRAINT tasks_priority_check
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),

    CONSTRAINT tasks_id_org_unique
        UNIQUE (id, organization_id)
);

CREATE TABLE activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    actor_membership_id UUID NOT NULL,
    project_id UUID,
    task_id UUID,
    action VARCHAR(100) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT activity_actor_membership_fk
        FOREIGN KEY (actor_membership_id, organization_id)
        REFERENCES memberships(id, organization_id),

    CONSTRAINT activity_project_fk
        FOREIGN KEY (project_id, organization_id)
        REFERENCES projects(id, organization_id),

    CONSTRAINT activity_task_fk
        FOREIGN KEY (task_id, organization_id)
        REFERENCES tasks(id, organization_id)
);

CREATE INDEX memberships_user_id_idx
    ON memberships(user_id);

CREATE INDEX projects_org_created_idx
    ON projects(organization_id, created_at DESC);

CREATE INDEX tasks_org_project_status_idx
    ON tasks(organization_id, project_id, status);

CREATE INDEX tasks_assignee_idx
    ON tasks(assignee_membership_id)
    WHERE assignee_membership_id IS NOT NULL;

CREATE INDEX activity_logs_org_created_idx
    ON activity_logs(organization_id, created_at DESC);
