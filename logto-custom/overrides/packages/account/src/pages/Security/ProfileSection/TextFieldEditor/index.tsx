/**
 * [NiceMatrix] Generic single-line text editor modal used for family name,
 * given name and nickname. Keeps focus within the modal and submits on Enter.
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import ReactModal from 'react-modal';
import { useTranslation } from 'react-i18next';

import styles from './index.module.scss';

type Props = {
  readonly isOpen: boolean;
  readonly title: string;
  readonly label: string;
  readonly initialValue: string;
  readonly maxLength?: number;
  readonly isSubmitting?: boolean;
  readonly errorMessage?: string;
  readonly onCancel: () => void;
  readonly onSubmit: (value: string) => void | Promise<void>;
};

const TextFieldEditor = ({
  isOpen,
  title,
  label,
  initialValue,
  maxLength = 100,
  isSubmitting,
  errorMessage,
  onCancel,
  onSubmit,
}: Props) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
      // defer focus to next tick so the modal is mounted
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialValue]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(value.trim());
  };

  return (
    <ReactModal
      ariaHideApp={false}
      isOpen={isOpen}
      className={styles.modal}
      overlayClassName={styles.overlay}
      shouldCloseOnEsc
      shouldCloseOnOverlayClick
      onRequestClose={onCancel}
    >
      <div className={styles.title}>{title}</div>
      <form className={styles.field} onSubmit={handleSubmit}>
        <label className={styles.label} htmlFor="nm-text-editor-input">
          {label}
        </label>
        <input
          ref={inputRef}
          id="nm-text-editor-input"
          className={styles.input}
          type="text"
          value={value}
          maxLength={maxLength}
          onChange={(event) => setValue(event.target.value)}
        />
        {errorMessage && <div className={styles.error}>{errorMessage}</div>}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={isSubmitting}
            onClick={onCancel}
          >
            {t('profile_section.cancel')}
          </button>
          <button type="submit" className={styles.primaryButton} disabled={isSubmitting}>
            {t('profile_section.save')}
          </button>
        </div>
      </form>
    </ReactModal>
  );
};

export default TextFieldEditor;
