# Les classes serialisees gardent leurs noms : le fichier d'etat les relit.
-keepattributes *Annotation*, InnerClasses
-keepclassmembers class io.github.diaslamka.freegames.** {
    *** Companion;
}
-keepclasseswithmembers class io.github.diaslamka.freegames.** {
    kotlinx.serialization.KSerializer serializer(...);
}
