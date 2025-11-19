import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import type {LoadContext, Plugin} from '@docusaurus/types';

export type AdoptionStatus = 'not planned' | 'planned' | 'partial' | 'full';
export type Category = 'product company' | 'OSS project' | 'consulting company';

export interface Adopter {
    name: string;
    logoUrl: string;
    website: string;
    description: string;
    scala3AdoptionStatus: AdoptionStatus | null;
    category: Category;
    size: number;
    sources: string[];
}

export interface AdoptersContent {
    adopters: Adopter[];
    unverified: { name: string; website: string }[];
    lastUpdated: string;
}

const allowedStatuses: Record<string, AdoptionStatus> = {
    'not planned': 'not planned',
    planned: 'planned',
    partial: 'partial',
    full: 'full',
};

const allowedCategories: Record<string, Category> = {
    'product company': 'product company',
    'oss project': 'OSS project',
    'consulting company': 'consulting company',
};

function validateString(value: unknown, name: string, fileName: string): string {
    if (typeof value !== 'string') {
        throw new Error(`Field "${name}" in ${fileName} must be a string`);
    }
    return value.trim();
}

function validateNumber(value: unknown, name: string, fileName: string): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value.trim());
        if (!Number.isNaN(parsed)) {
            return parsed;
        }
    }
    throw new Error(`Field "${name}" in ${fileName} must be a number`);
}

function parseAdoptionStatus(value: unknown, fileName: string): AdoptionStatus | null {
    if (value == null || (typeof value === 'string' && value.trim() === '')) {
        return null;
    }
    const status = validateString(value, 'scala3AdoptionStatus', fileName).toLowerCase();
    const normalized = allowedStatuses[status];
    if (!normalized) {
        const allowed = Object.keys(allowedStatuses).join(', ');
        throw new Error(
            `Invalid scala3AdoptionStatus "${value}" in ${fileName}. Allowed values: ${allowed}`,
        );
    }
    return normalized;
}

function parseCategory(value: unknown, fileName: string): Category {
    const key = validateString(value, 'category', fileName).toLowerCase();
    const normalized = allowedCategories[key];
    if (!normalized) {
        const allowed = Object.values(allowedCategories).join(', ');
        throw new Error(`Invalid category "${value}" in ${fileName}. Allowed values: ${allowed}`);
    }
    return normalized;
}

function parseSources(value: unknown, fileName: string): string[] {
    if (value == null) {
        return [];
    }
    if (Array.isArray(value)) {
        return value.map((entry, idx) => validateString(entry, `sources[${idx}]`, fileName));
    }
    if (typeof value === 'string') {
        return [validateString(value, 'sources', fileName)];
    }
    throw new Error(`Field "sources" in ${fileName} must be a list of strings`);
}

function loadAdopters(siteDir: string): AdoptersContent {
    const adoptersDir = path.join(siteDir, 'adopters');
    if (!fs.existsSync(adoptersDir)) {
        throw new Error(`Missing adopters directory at ${adoptersDir}`);
    }

    // Load unverified adopters list from adopters/_others.yaml if present
    const othersPath = path.join(adoptersDir, '_others.yaml');

    const entries = fs
        .readdirSync(adoptersDir)
        .filter((file) => file.endsWith('.yaml') && !file.endsWith('_others.yaml'))
        .map((fileName) => {
            const contents = fs.readFileSync(path.join(adoptersDir, fileName), 'utf8');
            const data = yaml.parse(contents) ?? {};
            if (typeof data !== 'object' || Array.isArray(data)) {
                throw new Error(`${fileName} must contain a YAML object`);
            }

            return {
                name: validateString((data as any).name, 'name', fileName),
                logoUrl: validateString((data as any).logoUrl, 'logoUrl', fileName),
                website: validateString((data as any).website, 'website', fileName),
                description: validateString((data as any).description, 'description', fileName),
                scala3AdoptionStatus: parseAdoptionStatus((data as any).scala3AdoptionStatus, fileName),
                category: parseCategory((data as any).category, fileName),
                size: validateNumber((data as any).size, 'size', fileName),
                sources: parseSources((data as any).sources, fileName),
            };
        })
        .sort((a, b) => {
            if (a.size === b.size) {
                return a.name.localeCompare(b.name);
            }
            return b.size - a.size;
        });

    if (entries.length === 0) {
        throw new Error(`No adopter entries found at ${adoptersDir}`);
    }

    let unverified: { name: string; website: string }[] = [];
    if (fs.existsSync(othersPath)) {
        const contents = fs.readFileSync(othersPath, 'utf8');
        const data = yaml.parse(contents) ?? [];
        if (!Array.isArray(data)) {
            throw new Error(`adopters/_others.yaml must contain a YAML list`);
        }

        // Build sets for duplicate detection
        const seenNames = new Set<string>();
        const seenWebsites = new Set<string>();
        const verifiedNames = new Set(entries.map((e) => e.name.toLowerCase()));
        const verifiedWebsites = new Set(entries.map((e) => e.website.toLowerCase()));

        unverified = data.map((item, idx) => {
            if (typeof item !== 'object' || item == null || Array.isArray(item)) {
                throw new Error(`Entry #${idx} in adopters/_others.yaml must be an object with name and website`);
            }
            const name = validateString((item as any).name, `name (others[${idx}])`, '_others.yaml');
            const website = validateString((item as any).website, `website (others[${idx}])`, '_others.yaml');

            const lname = name.toLowerCase();
            const lsite = website.toLowerCase();

            if (seenNames.has(lname)) {
                throw new Error(`Duplicate name "${name}" in adopters/_others.yaml`);
            }
            if (seenWebsites.has(lsite)) {
                throw new Error(`Duplicate website "${website}" in adopters/_others.yaml`);
            }
            if (verifiedNames.has(lname)) {
                throw new Error(`Unverified adopter "${name}" duplicates verified adopter name`);
            }
            if (verifiedWebsites.has(lsite)) {
                throw new Error(`Unverified adopter website "${website}" duplicates a verified adopter`);
            }

            seenNames.add(lname);
            seenWebsites.add(lsite);

            return {name, website};
        });

        // Sort alphabetically by name for stable output
        unverified.sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
        adopters: entries,
        unverified,
        lastUpdated: new Date().toISOString().slice(0, 10),
    };
}

export default function adoptersPlugin(context: LoadContext): Plugin<AdoptersContent> {
    return {
        name: 'adopters-plugin',
        loadContent() {
            return loadAdopters(context.siteDir);
        },
        contentLoaded({content, actions}) {
            if (content) {
                actions.setGlobalData(content);
            }
        },
    };
}
