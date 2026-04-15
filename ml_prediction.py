"""
Sleep Disorder ML Prediction
==============================
Combines the real-time Sleep Health dataset (sleep_health_dataset.csv)
with user report data (reports.json) to train and predict sleep disorders.

Target labels
  0 = None
  1 = Insomnia
  2 = Sleep Apnea

Run:
  pip install pandas scikit-learn
  python ml_prediction.py
"""

import json
import pandas as pd
from sklearn.ensemble import RandomForestClassifier, GradientBoostingClassifier
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import classification_report, accuracy_score
import warnings
warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────
# 1. Load the Sleep Health Dataset (CSV)
# ─────────────────────────────────────────────
def load_csv_dataset(path="sleep_health_dataset.csv"):
    df = pd.read_csv(path)

    # Parse Blood Pressure → systolic + diastolic
    df[["systolic", "diastolic"]] = (
        df["Blood Pressure"].str.split("/", expand=True).astype(float)
    )

    # Encode categorical columns
    gender_map   = {"Male": 0, "Female": 1}
    bmi_map      = {"Normal": 0, "Normal Weight": 0, "Overweight": 1, "Obese": 2}
    disorder_map = {"None": 0, "Insomnia": 1, "Sleep Apnea": 2}

    df["gender_enc"]  = df["Gender"].map(gender_map).fillna(0)
    df["bmi_enc"]     = df["BMI Category"].map(bmi_map).fillna(1)
    df["disorder_enc"] = df["Sleep Disorder"].map(disorder_map).fillna(0)

    # Occupation one-hot encoding
    df = pd.get_dummies(df, columns=["Occupation"], prefix="occ")

    feature_cols = [
        "Age", "gender_enc", "Sleep Duration", "Quality of Sleep",
        "Physical Activity Level", "Stress Level", "bmi_enc",
        "systolic", "diastolic", "Heart Rate", "Daily Steps"
    ]
    # Add occupation dummies
    occ_cols = [c for c in df.columns if c.startswith("occ_")]
    feature_cols += occ_cols

    X = df[feature_cols].values
    y = df["disorder_enc"].values
    return X, y, feature_cols


# ─────────────────────────────────────────────
# 2. Load User Reports from reports.json
# ─────────────────────────────────────────────
def load_user_reports(path="reports.json"):
    with open(path) as f:
        reports = json.load(f)

    rows = []
    for r in reports:
        # Map existing report fields to feature names
        try:
            bp_str = str(r.get("bp", "120/80"))
            if "/" in bp_str:
                sys_val, dia_val = bp_str.split("/")
            else:
                sys_val, dia_val = bp_str, "80"

            gender = 0 if str(r.get("gender", "")).lower() == "male" else 1
            bmi_raw = str(r.get("bmi", "")).lower()
            bmi_enc = 0 if "normal" in bmi_raw else (2 if "obese" in bmi_raw else 1)

            risk = str(r.get("riskLevel", "Low")).lower()
            if "high" in risk:
                label = 2          # treat High risk → Sleep Apnea
            elif "moderate" in risk:
                label = 1          # treat Moderate risk → Insomnia
            else:
                label = 0

            rows.append({
                "Age":                    float(r.get("age", 30)),
                "gender_enc":             gender,
                "Sleep Duration":         float(r.get("sleep_duration", 7)),
                "Quality of Sleep":       float(r.get("stress", 5)),   # map stress as proxy
                "Physical Activity Level": 45,                          # default
                "Stress Level":           float(r.get("stress", 5)),
                "bmi_enc":                bmi_enc,
                "systolic":               float(sys_val),
                "diastolic":              float(dia_val),
                "Heart Rate":             float(r.get("heart_rate", 75)),
                "Daily Steps":            5000,                         # default
                "label":                  label
            })
        except Exception:
            continue
    return rows


# ─────────────────────────────────────────────
# 3. Merge Datasets
# ─────────────────────────────────────────────
def build_combined_dataset():
    X_csv, y_csv, feature_cols = load_csv_dataset()

    user_rows = load_user_reports()
    if user_rows:
        user_df  = pd.DataFrame(user_rows)
        user_labels = user_df["label"].values
        base_cols = [
            "Age", "gender_enc", "Sleep Duration", "Quality of Sleep",
            "Physical Activity Level", "Stress Level", "bmi_enc",
            "systolic", "diastolic", "Heart Rate", "Daily Steps"
        ]
        # Pad occupation columns with 0 (not present in user reports)
        occ_cols   = [c for c in feature_cols if c.startswith("occ_")]
        for col in occ_cols:
            user_df[col] = 0

        X_user = user_df[feature_cols].values
        X_all  = __import__("numpy").vstack([X_csv, X_user])
        y_all  = __import__("numpy").concatenate([y_csv, user_labels])
    else:
        X_all, y_all = X_csv, y_csv

    return X_all, y_all, feature_cols


# ─────────────────────────────────────────────
# 4. Train & Evaluate Models
# ─────────────────────────────────────────────
def train_models(X, y):
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    scaler  = StandardScaler()
    X_train = scaler.fit_transform(X_train)
    X_test  = scaler.transform(X_test)

    models = {
        "Random Forest":       RandomForestClassifier(n_estimators=100, random_state=42),
        "KNN":                 KNeighborsClassifier(n_neighbors=5),
        "SVM":                 SVC(kernel="rbf", C=10, gamma=0.01, random_state=42),
        "Gradient Boosting":   GradientBoostingClassifier(n_estimators=100, random_state=42),
    }

    print("\n========== Model Performance ==========")
    best_model, best_acc = None, 0

    for name, clf in models.items():
        clf.fit(X_train, y_train)
        preds  = clf.predict(X_test)
        acc    = accuracy_score(y_test, preds)
        cv_acc = cross_val_score(clf, X_train, y_train, cv=5, scoring="accuracy").mean()
        print(f"\n{name}:")
        print(f"  Test Accuracy : {acc:.2%}")
        print(f"  CV  Accuracy  : {cv_acc:.2%}")
        print(classification_report(y_test, preds,
              target_names=["None", "Insomnia", "Sleep Apnea"],
              zero_division=0))
        if acc > best_acc:
            best_acc, best_model = acc, (clf, scaler, name)

    print(f"\n✅ Best model: {best_model[2]} ({best_acc:.2%} accuracy)")
    return best_model


# ─────────────────────────────────────────────
# 5. Predict for a New User Input
# ─────────────────────────────────────────────
def predict_user(clf, scaler, feature_cols, user_data: dict):
    """
    user_data example:
    {
        "age": 34, "gender": "Female", "sleep_duration": 5,
        "stress": 8, "bmi": "Obese", "bp": "127/80",
        "heart_rate": 76, "occupation": "Nurse"
    }
    """
    gender = 0 if str(user_data.get("gender", "")).lower() == "male" else 1
    bmi_raw = str(user_data.get("bmi", "")).lower()
    bmi_enc = 0 if "normal" in bmi_raw else (2 if "obese" in bmi_raw else 1)

    bp_str = str(user_data.get("bp", "120/80"))
    if "/" in bp_str:
        sys_val, dia_val = bp_str.split("/")
    else:
        sys_val, dia_val = bp_str, "80"

    row = {
        "Age":                    float(user_data.get("age", 30)),
        "gender_enc":             gender,
        "Sleep Duration":         float(user_data.get("sleep_duration", 7)),
        "Quality of Sleep":       float(user_data.get("stress", 5)),
        "Physical Activity Level": float(user_data.get("activity", 45)),
        "Stress Level":           float(user_data.get("stress", 5)),
        "bmi_enc":                bmi_enc,
        "systolic":               float(sys_val),
        "diastolic":              float(dia_val),
        "Heart Rate":             float(user_data.get("heart_rate", 75)),
        "Daily Steps":            float(user_data.get("daily_steps", 5000)),
    }

    # Occupation one-hot
    occ_cols = [c for c in feature_cols if c.startswith("occ_")]
    for col in occ_cols:
        row[col] = 0
    occ_key = f"occ_{user_data.get('occupation', '')}"
    if occ_key in row:
        row[occ_key] = 1

    import numpy as np
    X_new = np.array([[row[f] for f in feature_cols]])
    X_new = scaler.transform(X_new)
    pred  = clf.predict(X_new)[0]

    label_map = {0: "None", 1: "Insomnia", 2: "Sleep Apnea"}
    return label_map.get(pred, "Unknown")


# ─────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────
if __name__ == "__main__":
    print("Loading and merging datasets...")
    X, y, feature_cols = build_combined_dataset()
    print(f"Total samples: {len(y)}  |  Features: {len(feature_cols)}")
    print(f"Class distribution — None: {(y==0).sum()}, Insomnia: {(y==1).sum()}, Sleep Apnea: {(y==2).sum()}")

    clf, scaler, model_name = train_models(X, y)

    # ── Demo: predict a sample user from reports.json ──
    print("\n========== Sample Prediction ==========")
    sample_user = {
        "age": 34, "gender": "Female", "sleep_duration": 5,
        "stress": 8, "bmi": "Obese", "bp": "127/80",
        "heart_rate": 76, "occupation": "Nurse", "daily_steps": 4000
    }
    result = predict_user(clf, scaler, feature_cols, sample_user)
    print(f"Input  : {sample_user}")
    print(f"Predicted Sleep Disorder: {result}")
