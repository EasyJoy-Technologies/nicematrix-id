/**
 * [NiceMatrix] Single-select editor modal used for gender.
 */
import { useEffect, useState, type FormEvent } from 'react';
import ReactModal from 'react-modal';
import { useTranslation } from 'react-i18next';

import styles from './index.module.scss';

type Option = {
  readonly value: string;
  readonly label: string;
};

type Props = {
  readonly isOpen: boolean;
  readonly title: string;
  readonly label: string;
  readonly initialValue: string;
  readonly options: readonly Option[];
  readonly isSubmitting?: boolean;
  readonly errorMessage?: string;
  readonly onCancel: () => void;
  readonly onSubmit: (value: string) => void | Promise<void>;
};

const SelectFieldEditor = ({
  isOpen,
  title,
  label,
  initialValue,
  options,
  isSubmitting,
  errorMessage,
  onCancel,
  onSubmit,
}: Props) => {
  const { t } = useTranslation();
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (isOpen) {
      setValue(initialValue);
    }
  }, [isOpen, initialValue]);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(value);
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
        <label className={styles.label} htmlFor="nm-select-editor-input">
          {label}
        </label>
        <select
          id="nm-select-editor-input"
          className={styles.select}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        >
          <option value="">—</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
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

export default SelectFieldEditor;
