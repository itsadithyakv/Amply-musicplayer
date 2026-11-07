import { useMemo, useState } from 'react';
import { Button, IconButton, Select, SegmentedTabs, TextInput } from '@/components/ui';
import { useT, type MessageKey } from '@/i18n';
import {
  DEFAULT_RULES,
  RULE_FIELDS,
  RULE_SORTS,
  defaultRuleFor,
  evaluateRules,
  fieldKind,
  opsFor,
  type PlaylistRule,
  type PlaylistRules,
  type RuleField,
  type RuleOp,
  type RuleSort,
} from '@/services/playlistRules';
import { useLibraryStore } from '@/store/libraryStore';
import type { Playlist } from '@/types/music';

const FIELD_LABELS: Record<RuleField, MessageKey> = {
  genre: 'playlists.rules.field.genre',
  artist: 'playlists.rules.field.artist',
  album: 'playlists.rules.field.album',
  title: 'playlists.rules.field.title',
  year: 'playlists.rules.field.year',
  plays: 'playlists.rules.field.plays',
  duration: 'playlists.rules.field.duration',
  added: 'playlists.rules.field.added',
  played: 'playlists.rules.field.played',
  favorite: 'playlists.rules.field.favorite',
};

const OP_LABELS: Record<RuleOp, MessageKey> = {
  contains: 'playlists.rules.op.contains',
  notContains: 'playlists.rules.op.notContains',
  is: 'playlists.rules.op.is',
  isNot: 'playlists.rules.op.isNot',
  atLeast: 'playlists.rules.op.atLeast',
  atMost: 'playlists.rules.op.atMost',
  inLast: 'playlists.rules.op.inLast',
  notInLast: 'playlists.rules.op.notInLast',
  isTrue: 'playlists.rules.op.isTrue',
  isFalse: 'playlists.rules.op.isFalse',
};

const SORT_LABELS: Record<RuleSort, MessageKey> = {
  mostPlayed: 'playlists.rules.sort.mostPlayed',
  recentlyAdded: 'playlists.rules.sort.recentlyAdded',
  recentlyPlayed: 'playlists.rules.sort.recentlyPlayed',
  title: 'playlists.rules.sort.title',
  artist: 'playlists.rules.sort.artist',
  random: 'playlists.rules.sort.random',
};

const RuleRow = ({
  rule,
  onChange,
  onRemove,
  removable,
}: {
  rule: PlaylistRule;
  onChange: (rule: PlaylistRule) => void;
  onRemove: () => void;
  removable: boolean;
}) => {
  const { t } = useT();
  const kind = fieldKind(rule.field);
  const unit = kind === 'date' ? t('playlists.rules.unit.days') : rule.field === 'duration' ? t('playlists.rules.unit.minutes') : undefined;
  return (
    <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] items-center gap-2">
      <Select
        size="sm"
        label={t('playlists.rules.field')}
        value={rule.field}
        onChange={(event) => onChange(defaultRuleFor(event.target.value as RuleField))}
      >
        {RULE_FIELDS.map((field) => (
          <option key={field} value={field}>
            {t(FIELD_LABELS[field])}
          </option>
        ))}
      </Select>
      <Select size="sm" label={t('playlists.rules.op')} value={rule.op} onChange={(event) => onChange({ ...rule, op: event.target.value as RuleOp })}>
        {opsFor(rule.field).map((op) => (
          <option key={op} value={op}>
            {t(OP_LABELS[op])}
          </option>
        ))}
      </Select>
      {kind === 'flag' ? (
        <span />
      ) : (
        <TextInput
          size="sm"
          type={kind === 'text' ? 'text' : 'number'}
          min={kind === 'text' ? undefined : 0}
          value={rule.value}
          onValueChange={(value) => onChange({ ...rule, value })}
          aria-label={t('playlists.rules.value')}
          placeholder={t('playlists.rules.value')}
          trailing={unit ? <span className="shrink-0 text-[11px] text-amply-textMuted">{unit}</span> : undefined}
        />
      )}
      <IconButton name="close" label={t('playlists.rules.remove')} size="sm" variant="ghost" disabled={!removable} onClick={onRemove} />
    </div>
  );
};

/** Builds or edits a playlist that fills itself from rules. */
export const RulePlaylistEditor = ({
  initial,
  onSave,
  onCancel,
}: {
  initial: Playlist | null;
  onSave: (playlist: Playlist) => Promise<void>;
  onCancel: () => void;
}) => {
  const { t, tp } = useT();
  const [name, setName] = useState(initial?.name ?? '');
  const [rules, setRules] = useState<PlaylistRules>(initial?.rules ?? DEFAULT_RULES);
  const [saving, setSaving] = useState(false);
  const libraryVersion = useLibraryStore((state) => state.libraryVersion);
  const activityVersion = useLibraryStore((state) => state.activityVersion);
  const playlistId = initial?.id ?? 'draft';

  const matches = useMemo(
    () => evaluateRules(useLibraryStore.getState().getSongsById().values(), rules, playlistId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rules, playlistId, libraryVersion, activityVersion],
  );

  const update = (patch: Partial<PlaylistRules>) => setRules((current) => ({ ...current, ...patch }));
  const setRule = (index: number, rule: PlaylistRule) => update({ rules: rules.rules.map((entry, i) => (i === index ? rule : entry)) });

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        id: initial?.id ?? `custom_${Date.now()}`,
        name: name.trim() || t('playlists.rules.namePlaceholder'),
        type: 'custom',
        description: initial?.description ?? '',
        rules,
        songIds: matches,
        updatedAt: Math.floor(Date.now() / 1000),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-4">
      <TextInput
        value={name}
        onValueChange={setName}
        label={t('playlists.rules.name')}
        placeholder={t('playlists.rules.namePlaceholder')}
        maxLength={80}
        autoFocus
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="text-[12px] font-semibold text-amply-textSecondary">{t('playlists.rules.match')}</span>
        <SegmentedTabs
          size="sm"
          ariaLabel={t('playlists.rules.match')}
          value={rules.match}
          onChange={(match) => update({ match })}
          tabs={[
            { label: t('playlists.rules.matchAll'), value: 'all' },
            { label: t('playlists.rules.matchAny'), value: 'any' },
          ]}
        />
      </div>

      <div className="grid gap-2">
        {rules.rules.map((rule, index) => (
          <RuleRow
            key={index}
            rule={rule}
            removable={rules.rules.length > 1}
            onChange={(next) => setRule(index, next)}
            onRemove={() => update({ rules: rules.rules.filter((_, i) => i !== index) })}
          />
        ))}
        <div>
          <Button size="sm" variant="ghost" icon="add" onClick={() => update({ rules: [...rules.rules, defaultRuleFor('plays')] })} disabled={rules.rules.length >= 8}>
            {t('playlists.rules.add')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Select size="sm" label={t('playlists.rules.sort')} value={rules.sort} onChange={(event) => update({ sort: event.target.value as RuleSort })}>
          {RULE_SORTS.map((sort) => (
            <option key={sort} value={sort}>
              {t(SORT_LABELS[sort])}
            </option>
          ))}
        </Select>
        <TextInput
          size="sm"
          type="number"
          min={1}
          label={t('playlists.rules.limit')}
          placeholder={t('playlists.rules.noLimit')}
          value={rules.limit ? String(rules.limit) : ''}
          onValueChange={(value) => {
            const parsed = Number.parseInt(value, 10);
            update({ limit: Number.isFinite(parsed) && parsed > 0 ? parsed : null });
          }}
        />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <p role="status" className="text-[12px] font-medium text-amply-textSecondary">
          {tp('playlists.rules.matches', matches.length)}
        </p>
        <div className="flex gap-2">
          <Button onClick={onCancel}>{t('common.cancel')}</Button>
          <Button variant="primary" icon="check" onClick={() => void save()} loading={saving}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
};
