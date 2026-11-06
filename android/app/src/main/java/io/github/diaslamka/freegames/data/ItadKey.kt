package io.github.diaslamka.freegames.data

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * La cle IsThereAnyDeal de l'utilisateur (1.48.0), chiffree par une cle du Keystore Android -- comme le jeton de la mise a jour
 * et le secret du relais.
 *
 * C'est une cle PERSONNELLE, creee par l'utilisateur sur isthereanydeal.com (les conditions du service l'exigent) : l'appli n'en
 * embarque aucune. Elle part vers api.isthereanydeal.com et nulle part ailleurs ; elle n'est pas dans l'etat de l'appli, pas
 * dans l'export, pas dans une sauvegarde (allowBackup=false), jamais dans le journal ni dans un rapport.
 */
object ItadKey {
    private const val ALIAS = "fgc-itad"
    private const val FILE = "itad.bin"

    private val FORM = Regex("^[A-Za-z0-9_-]{8,100}$")

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        g.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return g.generateKey()
    }

    /** Une cle qui a la forme de celles du service (lettres, chiffres, tirets), sans espace ; sinon null. */
    fun plausible(raw: String?): String? = raw?.trim()?.takeIf { FORM.matches(it) }

    fun save(context: Context, value: String): Boolean {
        val clean = plausible(value) ?: return false
        return try {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.ENCRYPT_MODE, key())
            val out = c.iv + c.doFinal(clean.toByteArray(Charsets.UTF_8))
            val f = File(context.filesDir, FILE)
            val tmp = File(context.filesDir, "$FILE.tmp")
            tmp.writeBytes(out)
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
            true
        } catch (_: Exception) {
            false
        }
    }

    fun load(context: Context): String? = try {
        val all = File(context.filesDir, FILE).takeIf { it.exists() }?.readBytes()
        if (all == null || all.size < 12 + 16) {
            null
        } else {
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, all.copyOfRange(0, 12)))
            plausible(String(c.doFinal(all.copyOfRange(12, all.size)), Charsets.UTF_8))
        }
    } catch (_: Exception) {
        null
    }

    fun present(context: Context): Boolean = File(context.filesDir, FILE).exists()

    fun clear(context: Context) {
        File(context.filesDir, FILE).delete()
        runCatching { KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.deleteEntry(ALIAS) }
    }
}
