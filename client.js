/**
 * Client 部分：设置页里的「归档会话清理」，提供开关与保留期限。
 */

window.__ModuleLoader__.load({
  id: '@local/archive-cleanup',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const NS = 'plugins.archiveRetention'
    const ENTRY_ID = 'archive-retention'

    const en = {
      'section.title': 'Archived session cleanup',
      'heading': 'Archived session cleanup',
      'lead': 'Archived sessions are deleted automatically once they have been archived for the retention period. Deletion removes the session log and its grouping record, and cannot be undone.',
      'enabled.title': 'Clean up archived sessions',
      'enabled.description': 'Only archived sessions are removed; one used again after archiving starts its clock over.',
      'retention.title': 'Retention period',
      'retention.description': 'A session is deleted once it has been archived for this many days.',
      'retention.unit': 'days',
      'schedule': 'The check runs about once an hour in the background, so deletion happens at the next check after the period ends.',
      save: 'Save',
      saving: 'Saving…',
      saved: 'Saved',
      failed: 'Could not save',
      invalid: 'Enter a whole number between 1 and 3650.',
      unavailable: 'This setting is not available in the current profile.',
    }

    const zh = {
      'section.title': '归档会话清理',
      'heading': '归档会话清理',
      'lead': '归档的会话在归档满保留期限后自动删除。删除会移除会话日志与分组记录，且无法恢复。',
      'enabled.title': '自动清理归档会话',
      'enabled.description': '只处理归档的会话，归档后又被使用的会重新计时。',
      'retention.title': '保留期限',
      'retention.description': '归档满这么多天后删除。',
      'retention.unit': '天',
      'schedule': '检查在后台大约每小时执行一次，实际删除发生在到期后的下一次检查。',
      save: '保存',
      saving: '保存中…',
      saved: '已保存',
      failed: '保存失败',
      invalid: '请输入 1 到 3650 之间的整数。',
      unavailable: '当前配置下无法修改这项设置。',
    }

    const CSS = `
.a1r-page{display:flex;flex-direction:column;gap:4px;padding-bottom:24px}
.a1r-heading{margin:0;font-size:16px;line-height:24px;color:var(--dsw-alias-label-primary)}
.a1r-lead{margin:8px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);max-width:640px}
.a1r-row{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:16px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
.a1r-text{min-width:0}
.a1r-title{font-size:14px;line-height:20px;color:var(--dsw-alias-label-primary)}
.a1r-description{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);max-width:560px}
.a1r-field{display:flex;flex:none;align-items:center;gap:8px}
.a1r-unit{font-size:12px;color:var(--dsw-alias-label-secondary)}
.a1r-number{width:88px;height:32px;padding:0 10px;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px}
.a1r-number:disabled{opacity:.5}
.a1r-toggle{position:relative;flex:none;width:44px;height:24px;padding:0;border:none;border-radius:12px;background:var(--dsw-alias-state-idle-primary);cursor:pointer;transition:background .15s ease}
.a1r-toggle[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
.a1r-toggle:disabled{opacity:.5;cursor:default}
.a1r-knob{position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;transition:transform .15s ease}
.a1r-toggle[aria-checked="true"] .a1r-knob{transform:translateX(20px)}
.a1r-note{margin:12px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);max-width:640px}
.a1r-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding-top:16px}
.a1r-notice{font-size:12px}
.a1r-saved{color:var(--dsw-alias-state-success-primary)}
.a1r-failed{color:var(--dsw-alias-state-error-primary)}
.a1r-save{height:32px;padding:0 16px;border:none;border-radius:8px;background:var(--dsw-alias-brand-primary);color:#fff;font:inherit;font-size:13px;cursor:pointer}
.a1r-save:disabled{opacity:.5;cursor:default}
`

    function installStyles() {
      const tagId = '@local/archive-cleanup/page.css'
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(tagId)}]`) !== null) return undefined
      const tag = document.createElement('style')
      tag.dataset.plugin = '@local/archive-cleanup'
      tag.dataset.pluginCss = tagId
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    return {
      inject: ['slots', 'locale', 'configForms'],
      apply(ctx) {
        const form = ctx.configForms.get(ENTRY_ID)
        const subscribe = (listener) => form.subscribe(listener)
        const readSnapshot = () => form.getSnapshot()

        function SettingsPage(props) {
          const { t } = props
          const [snapshot, setSnapshot] = React.useState(readSnapshot)
          const [enabledDraft, setEnabledDraft] = React.useState(null)
          const [daysDraft, setDaysDraft] = React.useState(null)
          const [busy, setBusy] = React.useState(false)
          const [notice, setNotice] = React.useState(null)

          React.useEffect(() => subscribe(() => { setSnapshot(readSnapshot()) }), [])

          const value = snapshot !== null && snapshot !== undefined && snapshot.value !== undefined ? snapshot.value : {}
          const writable = snapshot !== null && snapshot !== undefined && snapshot.status === 'ready' && snapshot.writable === true

          if (snapshot === null || snapshot === undefined || snapshot.status === 'unavailable') {
            return h('div', { className: 'a1r-page' },
              h('h3', { className: 'a1r-heading' }, t('heading')),
              h('p', { className: 'a1r-note' }, t('unavailable'))
            )
          }

          const savedEnabled = value.enabled !== false
          const savedDays = typeof value.retentionDays === 'number' ? value.retentionDays : 30
          const enabled = enabledDraft === null ? savedEnabled : enabledDraft
          const daysText = daysDraft === null ? String(savedDays) : daysDraft
          const parsedDays = Number(daysText)
          const daysValid = Number.isInteger(parsedDays) && parsedDays >= 1 && parsedDays <= 3650

          const save = async () => {
            if (!writable || busy) return
            if (!daysValid) {
              setNotice('invalid')
              return
            }
            setBusy(true)
            setNotice(null)
            try {
              const accepted = await form.mutate([
                { op: 'set', path: ['enabled'], value: enabled },
                { op: 'set', path: ['retentionDays'], value: parsedDays },
              ])
              setNotice(accepted ? 'saved' : 'failed')
              if (accepted) {
                setEnabledDraft(null)
                setDaysDraft(null)
              }
            } catch {
              setNotice('failed')
            } finally {
              setBusy(false)
            }
          }

          const noticeClass = notice === 'saved'
            ? 'a1r-notice a1r-saved'
            : notice === 'invalid' ? 'a1r-notice a1r-failed' : 'a1r-notice a1r-failed'

          return h('div', { className: 'a1r-page' },
            h('h3', { className: 'a1r-heading' }, t('heading')),
            h('p', { className: 'a1r-lead' }, t('lead')),
            h('div', { className: 'a1r-row' },
              h('div', { className: 'a1r-text' },
                h('div', { className: 'a1r-title' }, t('enabled.title')),
                h('p', { className: 'a1r-description' }, t('enabled.description'))
              ),
              h('button', {
                type: 'button',
                role: 'switch',
                'aria-checked': enabled ? 'true' : 'false',
                'aria-label': t('enabled.title'),
                className: 'a1r-toggle',
                disabled: !writable || busy,
                onClick: () => {
                  setEnabledDraft(!enabled)
                  setNotice(null)
                },
              }, h('span', { className: 'a1r-knob' }))
            ),
            h('div', { className: 'a1r-row' },
              h('div', { className: 'a1r-text' },
                h('div', { className: 'a1r-title' }, t('retention.title')),
                h('p', { className: 'a1r-description' }, t('retention.description'))
              ),
              h('div', { className: 'a1r-field' },
                h('input', {
                  type: 'number',
                  min: 1,
                  max: 3650,
                  step: 1,
                  value: daysText,
                  disabled: !writable || busy,
                  'aria-label': t('retention.title'),
                  className: 'a1r-number',
                  onChange: (event) => {
                    setDaysDraft(event.target.value)
                    setNotice(null)
                  },
                }),
                h('span', { className: 'a1r-unit' }, t('retention.unit'))
              )
            ),
            h('p', { className: 'a1r-note' }, t('schedule')),
            h('div', { className: 'a1r-actions' },
              notice === null ? null : h('span', { className: noticeClass }, t(notice)),
              h('button', {
                type: 'button',
                className: 'a1r-save',
                disabled: !writable || busy,
                onClick: save,
              }, busy ? t('saving') : t('save'))
            )
          )
        }

        ctx.effect(() => ctx.locale.register(NS, { en, zh }))
        ctx.effect(() => installStyles())
        ctx.effect(() => ctx.configForms.whileServed([ENTRY_ID], () => ctx.slots.inject('settings.section', () =>
          ctx.slots.register({
            name: 'settings.section',
            id: ENTRY_ID,
            order: 35,
            label: () => ctx.locale.bind(NS)('section.title'),
            locale: NS,
          }, SettingsPage))))
      },
    }
  },
})
