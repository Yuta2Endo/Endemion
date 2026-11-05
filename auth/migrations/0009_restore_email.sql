-- Ссылка «это были не вы» из письма о смене почты может вернуть прежний адрес
ALTER TABLE login_alerts ADD COLUMN restore_email TEXT;
